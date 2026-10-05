#!/usr/bin/env bash
# Unfurl's updater: fetches the newest commit of one git branch and switches the
# running server to it — but only if the new version proves itself first.
#
#   update.sh              apply an update if there is one (what the supervisor runs every minute)
#   update.sh --check      just say whether an update is waiting (exit 10 if so, 0 if up to date)
#   update.sh --status     which build is live, which is the fallback, which was rejected
#   update.sh --rollback   go back to the previous version right now
#   update.sh --force      try again with a version that was rejected before
#   (add --no-restart to any of these to switch files without restarting anything)
#
# Layout under $UNFURL_HOME (default /opt/unfurl):
#   repo/          a bare copy of the git repository
#   releases/<id>/ one folder per version, never modified after it is made
#   current        symlink to the live release      previous   symlink to the one before
#   update.log     what happened and why             failed     the build that was rejected
#
# What makes it safe:
#   1. the new version is unpacked beside the live one and must pass `serve.py --selftest`
#      (serves every page, stores and reads data) BEFORE anything is switched;
#   2. the switch is one atomic symlink change, followed by a restart;
#   3. the server must then report the NEW build on /healthz within $UNFURL_HEALTH_TIMEOUT
#      seconds, otherwise the old version is put back and the new one is blacklisted;
#   4. your data lives outside all of this ($UNFURL_DATA), so no update or rollback can touch it.
set -uo pipefail

HOME_DIR="${UNFURL_HOME:-/opt/unfurl}"
REPO_URL="${UNFURL_REPO_URL:-}"
BRANCH="${UNFURL_BRANCH:-main}"
KEEP="${UNFURL_KEEP_RELEASES:-5}"
PYTHON="${UNFURL_PYTHON:-python3}"
PORT="${UNFURL_PORT:-8765}"
LISTEN="${UNFURL_HOST:-127.0.0.1}"
case "$LISTEN" in 0.0.0.0|::|"") LISTEN=127.0.0.1 ;; esac    # asking "any address" -> ask the local one
case "$LISTEN" in *:*) LISTEN="[$LISTEN]" ;; esac
HEALTH_URL="${UNFURL_HEALTH_URL:-http://${LISTEN}:${PORT}/healthz}"
HEALTH_TIMEOUT="${UNFURL_HEALTH_TIMEOUT:-30}"
RESTART_CMD="${UNFURL_RESTART_CMD:-}"
PIDFILE="${UNFURL_PIDFILE:-$HOME_DIR/server.pid}"

MODE=apply; RESTART=1; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --status) MODE=status ;;
    --rollback) MODE=rollback ;;
    --force) FORCE=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$HOME_DIR/releases" || { echo "cannot create $HOME_DIR/releases" >&2; exit 2; }
LOG="$HOME_DIR/update.log"

log() {
  local line; line="$(date '+%Y-%m-%d %H:%M:%S') update: $*"
  echo "$line" >&2
  # keep the log file from growing without bound
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1"; fi
  echo "$line" >>"$LOG" 2>/dev/null || true
}

# ---------------------------------------------------------------- one updater at a time
LOCK="$HOME_DIR/.update.lock"
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ >"$LOCK/pid"; return 0; fi
  local other; other="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then return 1; fi
  rm -rf "$LOCK"                       # the previous updater died without cleaning up
  mkdir "$LOCK" 2>/dev/null && { echo $$ >"$LOCK/pid"; return 0; }
  return 1
}
release_lock() { rm -rf "$LOCK"; }

# ---------------------------------------------------------------- helpers
build_of() { cat "$1/BUILD" 2>/dev/null || true; }
current_dir() { readlink -f "$HOME_DIR/current" 2>/dev/null || true; }
previous_dir() { readlink -f "$HOME_DIR/previous" 2>/dev/null || true; }
current_build() { local d; d="$(current_dir)"; [ -n "$d" ] && build_of "$d"; }
point() {  # point <symlink-name> <release-dir>: atomically
  ln -sfn "$2" "$HOME_DIR/$1.tmp" && mv -Tf "$HOME_DIR/$1.tmp" "$HOME_DIR/$1"
}

health_build() {
  "$PYTHON" -c 'import json,sys,urllib.request
try:
    print(json.load(urllib.request.urlopen(sys.argv[1], timeout=3)).get("build", ""))
except Exception:
    sys.exit(1)' "$HEALTH_URL" 2>/dev/null
}

wait_healthy() {  # wait_healthy <build>
  local want="$1" i=0 got
  while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    got="$(health_build)" && [ "$got" = "$want" ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

restart_server() {
  [ "$RESTART" = 1 ] || return 0
  if [ -n "$RESTART_CMD" ]; then
    [ "$RESTART_CMD" = none ] && return 0
    bash -c "$RESTART_CMD"; return $?
  fi
  if [ -s "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    touch "$HOME_DIR/.restart-requested"       # tells the supervisor this exit is on purpose
    kill -TERM "$(cat "$PIDFILE")"; return $?
  fi
  return 0
}

manages_restart() { [ "$RESTART" = 1 ] && [ "$RESTART_CMD" != none ] && { [ -n "$RESTART_CMD" ] || [ -s "$PIDFILE" ]; }; }

ensure_repo() {
  [ -n "$REPO_URL" ] || [ -d "$HOME_DIR/repo" ] || return 1
  if [ ! -d "$HOME_DIR/repo" ]; then
    git init --bare --quiet "$HOME_DIR/repo" || return 1
    git -C "$HOME_DIR/repo" remote add origin "$REPO_URL" || return 1
  elif [ -n "$REPO_URL" ] && [ "$(git -C "$HOME_DIR/repo" remote get-url origin 2>/dev/null)" != "$REPO_URL" ]; then
    git -C "$HOME_DIR/repo" remote set-url origin "$REPO_URL" || return 1
  fi
}

fetch_branch() {
  local t=(); command -v timeout >/dev/null 2>&1 && t=(timeout 120)
  GIT_TERMINAL_PROMPT=0 ${t[@]+"${t[@]}"} git -C "$HOME_DIR/repo" fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>"$HOME_DIR/.fetch-error"
}

# ---------------------------------------------------------------- modes
status() {
  echo "live:     $(current_build || true) ($(current_dir))"
  echo "previous: $(build_of "$(previous_dir)") ($(previous_dir))"
  echo "rejected: $(cat "$HOME_DIR/failed" 2>/dev/null || echo none)"
  echo "branch:   $BRANCH  repo: ${REPO_URL:-$(git -C "$HOME_DIR/repo" remote get-url origin 2>/dev/null || echo '(none)')}"
}

do_rollback() {
  local prev cur; prev="$(previous_dir)"; cur="$(current_dir)"
  if [ -z "$prev" ] || [ ! -d "$prev" ] || [ "$prev" = "$cur" ]; then log "nothing to roll back to"; return 1; fi
  log "rolling back from $(build_of "$cur") to $(build_of "$prev")"
  build_of "$cur" >"$HOME_DIR/failed"
  point current "$prev"
  restart_server
  if manages_restart && ! wait_healthy "$(build_of "$prev")"; then log "WARNING: the old version did not come back healthy either; check the server's log"; return 1; fi
  return 0
}

prune() {
  local keep_a keep_b n=0 d
  keep_a="$(current_dir)"; keep_b="$(previous_dir)"
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    d="$HOME_DIR/releases/$d"
    [ "$d" = "$keep_a" ] || [ "$d" = "$keep_b" ] && continue
    n=$((n + 1))
    [ "$n" -gt "$KEEP" ] && rm -rf "$d"
  done < <(ls -1t "$HOME_DIR/releases" 2>/dev/null)
}

apply() {
  if ! ensure_repo; then log "no repository configured (set UNFURL_REPO_URL); automatic updates are off"; return 0; fi
  if ! fetch_branch; then
    local err; err="$(tr '\n' ' ' <"$HOME_DIR/.fetch-error" | cut -c1-300)"
    if [ "$(cat "$HOME_DIR/.fetch-failing" 2>/dev/null)" != "$err" ]; then log "couldn't fetch $BRANCH: ${err:-unknown error} (will keep trying quietly)"; fi
    echo "$err" >"$HOME_DIR/.fetch-failing"
    return 3
  fi
  rm -f "$HOME_DIR/.fetch-failing"

  local full short live
  full="$(git -C "$HOME_DIR/repo" rev-parse "refs/remotes/origin/$BRANCH" 2>/dev/null)" || { log "branch '$BRANCH' not found in the repository"; return 3; }
  short="${full:0:12}"
  live="$(current_build || true)"

  if [ "$short" = "$live" ]; then [ "$MODE" = check ] && echo "up to date ($live)"; return 0; fi
  if [ "$MODE" = check ]; then echo "update available: ${live:-none} -> $short"; return 10; fi
  if [ "$FORCE" = 0 ] && [ "$short" = "$(cat "$HOME_DIR/failed" 2>/dev/null || true)" ]; then return 0; fi   # already tried and rejected

  local rel="$HOME_DIR/releases/$short" tmp="$HOME_DIR/releases/.incoming-$short"
  if [ ! -f "$rel/BUILD" ]; then
    rm -rf "$tmp" "$rel"; mkdir -p "$tmp"
    if ! { git -C "$HOME_DIR/repo" archive "$full" | tar -x -C "$tmp"; } 2>"$HOME_DIR/.archive-error"; then
      log "couldn't unpack $short: $(tr '\n' ' ' <"$HOME_DIR/.archive-error" | cut -c1-200)"; rm -rf "$tmp"; return 1
    fi
    echo "$short" >"$tmp/BUILD"
    mv "$tmp" "$rel"
  fi

  # --- prove the new version before it can touch anything live
  local out
  if [ ! -f "$rel/serve.py" ]; then out="serve.py is missing"
  else
    out="$(cd "$rel" && env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$PYTHON" serve.py --selftest 2>&1)"
    local rc=$?
    for f in "$rel"/deploy/*.sh; do [ -f "$f" ] && ! bash -n "$f" 2>/dev/null && { out="$out; $(basename "$f") has a syntax error"; rc=1; }; done
    [ "$rc" = 0 ] && out=""
  fi
  if [ -n "$out" ]; then
    log "NOT updating to $short: it failed its self-test, so the live version ($live) keeps running. $(echo "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-400)"
    echo "$short" >"$HOME_DIR/failed"
    return 1
  fi

  # --- switch
  local old; old="$(current_dir)"
  [ -n "$old" ] && [ "$old" != "$rel" ] && point previous "$old"
  point current "$rel"
  log "switched ${live:-(nothing)} -> $short; restarting"
  restart_server

  if manages_restart; then
    if wait_healthy "$short"; then
      log "update to $short is live and healthy"
      rm -f "$HOME_DIR/failed"
    else
      log "the server did not come up healthy on $short within ${HEALTH_TIMEOUT}s — putting $live back"
      if [ -n "$old" ] && [ -d "$old" ]; then
        point current "$old"; restart_server
        wait_healthy "$live" && log "rolled back: $live is running again" || log "WARNING: $live did not come back healthy either; check the server's log"
      fi
      echo "$short" >"$HOME_DIR/failed"
      return 1
    fi
  else
    log "update to $short is in place; it takes effect the next time the server starts"
    rm -f "$HOME_DIR/failed"
  fi
  prune
  return 0
}

if [ "$MODE" = status ]; then status; exit 0; fi
acquire_lock || { [ "$MODE" = check ] || echo "another update is already running" >&2; exit 0; }
trap release_lock EXIT
case "$MODE" in
  rollback) do_rollback; exit $? ;;
  *) apply; exit $? ;;
esac
