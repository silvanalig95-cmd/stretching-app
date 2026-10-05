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
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${UNFURL_UPDATER:-$here/update.sh}"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') unfurl: $*" >&2; }
mkdir -p "$HOME_DIR/releases" || { say "cannot create $HOME_DIR"; exit 2; }

# ---- first start: get a version to run
if [ ! -e "$HOME_DIR/current" ]; then
  if [ -n "${UNFURL_REPO_URL:-}" ] && "$UPDATER" --no-restart && [ -e "$HOME_DIR/current" ]; then :
  elif [ -n "$SEED" ] && [ -f "$SEED/serve.py" ]; then
    id="seed-$(cat "$SEED/BUILD" 2>/dev/null || echo local)"
    rm -rf "$HOME_DIR/releases/$id"; cp -r "$SEED" "$HOME_DIR/releases/$id"
    [ -f "$HOME_DIR/releases/$id/BUILD" ] || echo "${id#seed-}" >"$HOME_DIR/releases/$id/BUILD"
    ln -sfn "releases/$id" "$HOME_DIR/current"
    say "starting from the copy that came with this install ($id)"
  fi
  [ -e "$HOME_DIR/current" ] || { say "no version of Unfurl to run: set UNFURL_REPO_URL (and UNFURL_BRANCH) so it can be downloaded"; exit 1; }
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
  say "the server stopped (exit $rc) after ${lived}s"
  if [ "$quick" -ge "$CRASH_LIMIT" ]; then
    say "it keeps failing right after starting; trying the previous version"
    "$UPDATER" --rollback --no-restart >/dev/null || say "no earlier version to fall back to"
    quick=0
  fi
  sleep $(( quick > 0 ? (quick < 15 ? quick * 2 : 30) : 1 ))
done
rm -f "$PIDFILE"
say "stopped"
