#!/usr/bin/env bash
# Runs Unfurl and keeps it up to date. This one script is the whole "service":
#   - starts the server from the live release and restarts it if it ever stops,
#   - every UNFURL_UPDATE_INTERVAL seconds (default 60) asks update.sh whether the git branch has something new,
#   - if the live version keeps crashing right after starting, falls back to the previous version.
# Put it under systemd (see unfurl.service), Docker (see Dockerfile) or just run it in a terminal.
set -u

HOME_DIR="${UNFURL_HOME:-/opt/unfurl}"
INTERVAL="${UNFURL_UPDATE_INTERVAL:-60}"
PYTHON="${UNFURL_PYTHON:-python3}"
SEED="${UNFURL_SEED:-}"               # a folder with a ready copy of the app, used if there is no release yet (Docker image)
PIDFILE="${UNFURL_PIDFILE:-$HOME_DIR/server.pid}"
CRASH_LIMIT="${UNFURL_CRASH_LIMIT:-5}"   # quick failures in a row before falling back to the previous version
export UNFURL_HOME="$HOME_DIR" UNFURL_PIDFILE="$PIDFILE"
unset UNFURL_BUILD   # the build id must be the release's own (BUILD file), or the updater's health check could never see an update arrive
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${UNFURL_UPDATER:-$here/update.sh}"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') unfurl: $*" >&2; }
mkdir -p "$HOME_DIR/releases" || { say "cannot create $HOME_DIR"; exit 2; }

# ---- first start: get a version to run
seed_release() {   # copy the image's built-in app into releases/ and make it live
  local id; id="seed-$(cat "$SEED/BUILD" 2>/dev/null || echo local)"
  rm -rf "$HOME_DIR/releases/$id"; cp -r "$SEED" "$HOME_DIR/releases/$id"
  [ -f "$HOME_DIR/releases/$id/BUILD" ] || echo "${id#seed-}" >"$HOME_DIR/releases/$id/BUILD"
  ln -sfn "releases/$id" "$HOME_DIR/current.tmp" && mv -Tf "$HOME_DIR/current.tmp" "$HOME_DIR/current"
  say "running the copy that came with this install ($id)"
}
if [ ! -e "$HOME_DIR/current" ]; then
  if [ -n "${UNFURL_REPO_URL:-}" ] && "$UPDATER" --no-restart && [ -e "$HOME_DIR/current" ]; then :
  elif [ -n "$SEED" ] && [ -f "$SEED/serve.py" ]; then seed_release
  fi
  [ -e "$HOME_DIR/current" ] || { say "no version of Unfurl to run: set UNFURL_REPO_URL (and UNFURL_BRANCH) so it can be downloaded"; exit 1; }
elif [ -z "${UNFURL_REPO_URL:-}" ] && [ -n "$SEED" ] && [ -f "$SEED/BUILD" ]; then
  # No repository to follow: the built-in copy IS the version. After rebuilding the image, use the new one.
  live="$(basename "$(readlink -f "$HOME_DIR/current")")"
  case "$live" in seed-*) [ "$live" = "seed-$(cat "$SEED/BUILD")" ] || seed_release ;; esac
fi

SERVER_PID=""; UPDATER_PID=""; stopping=0
shutdown() {
  stopping=1
  [ -n "$UPDATER_PID" ] && kill "$UPDATER_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill -TERM "$SERVER_PID" 2>/dev/null
}
trap shutdown TERM INT

# ---- the update loop
if [ "$INTERVAL" -gt 0 ] 2>/dev/null; then
  (
    trap 'exit 0' TERM INT
    while true; do
      sleep "$INTERVAL" & wait $!
      "$UPDATER" >/dev/null          # update.sh reports what matters on stderr and in update.log
    done
  ) &
  UPDATER_PID=$!
fi

# ---- the server loop
quick=0
while [ "$stopping" = 0 ]; do
  ( cd "$HOME_DIR/current" && exec "$PYTHON" serve.py --no-open ) &
  SERVER_PID=$!
  echo "$SERVER_PID" >"$PIDFILE"
  started="$(date +%s)"
  wait "$SERVER_PID"; rc=$?
  while [ "$stopping" = 1 ] && kill -0 "$SERVER_PID" 2>/dev/null; do wait "$SERVER_PID" 2>/dev/null; done
  [ "$stopping" = 1 ] && break
  if [ -e "$HOME_DIR/.restart-requested" ]; then          # the updater asked for this restart
    rm -f "$HOME_DIR/.restart-requested"; quick=0; continue
  fi
  lived=$(( $(date +%s) - started ))
  if [ "$lived" -lt 10 ]; then quick=$((quick + 1)); else quick=0; fi
  live_build="$(cat "$HOME_DIR/current/BUILD" 2>/dev/null || true)"
  [ "$lived" -ge 30 ] && [ -n "$live_build" ] && echo "$live_build" >"$HOME_DIR/healthy"    # it ran for a while: this version works
  say "the server stopped (exit $rc) after ${lived}s"
  if [ "$quick" -ge "$CRASH_LIMIT" ]; then
    # Falling back is for a NEW version that never worked. A version that has run fine before and now fails to start
    # has a configuration or environment problem (missing login, port in use, full disk); an older version won't fix that,
    # and could be too old for the saved data.
    if [ "$live_build" != "$(cat "$HOME_DIR/healthy" 2>/dev/null || true)" ]; then
      say "this version has never run properly and keeps failing right after starting; trying the previous one"
      "$UPDATER" --rollback --no-restart >/dev/null || say "no earlier version to fall back to"
    else
      say "it keeps failing right after starting. This version ran fine before, so the cause is probably the settings or the machine (see the lines above); not switching versions."
    fi
    quick=$((CRASH_LIMIT))   # keep backing off, and don't repeat the message every few seconds
  fi
  sleep $(( quick >= CRASH_LIMIT ? 30 : quick > 0 ? quick * 2 : 1 ))
done
rm -f "$PIDFILE"
say "stopped"
