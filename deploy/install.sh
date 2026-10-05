#!/usr/bin/env bash
# One-time setup of Unfurl as an always-on, self-updating service on a Linux server with systemd.
#
#   git clone https://github.com/YOU/stretching-app.git && cd stretching-app
#   sudo deploy/install.sh --host unfurl.internal
#
# Options (all optional if this folder is a git clone with an 'origin'):
#   --repo URL      where updates come from            (default: this clone's origin)
#   --branch NAME   the branch the server follows       (default: main)
#   --host NAME     name(s) people type in the browser  (comma-separated; goes into UNFURL_ALLOWED_HOSTS)
#   --port N        (default 8765)
#   --home DIR      app + releases                       (default /opt/unfurl)
#   --data DIR      your data (never touched by updates) (default /var/lib/unfurl)
#   --user NAME     service account                      (default unfurl)
#   --no-service    don't create a user or a systemd unit; just prepare --home (for trying it out)
# Safe to run again: it never overwrites an existing settings file or your data.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="" BRANCH=main HOSTS="" PORT=8765 HOME_DIR=/opt/unfurl DATA=/var/lib/unfurl SVC_USER=unfurl SERVICE=1
ENVFILE=/etc/unfurl/unfurl.env
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;; --branch) BRANCH="$2"; shift 2 ;; --host) HOSTS="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;; --home) HOME_DIR="$2"; shift 2 ;; --data) DATA="$2"; shift 2 ;;
    --user) SVC_USER="$2"; shift 2 ;; --env-file) ENVFILE="$2"; shift 2 ;; --no-service) SERVICE=0; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$REPO" ]; then REPO="$(git -C "$HERE/.." remote get-url origin 2>/dev/null || true)"; fi
[ -n "$REPO" ] || { echo "Tell me where the app lives: --repo <git url>" >&2; exit 2; }
command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
if [ "$SERVICE" = 1 ]; then
  [ "$(id -u)" = 0 ] || { echo "Run with sudo (or add --no-service to just prepare the folder)." >&2; exit 2; }
  command -v systemctl >/dev/null || { echo "systemd not found; use the Docker setup in deploy/README.md instead, or --no-service" >&2; exit 2; }
fi

run_as() { if [ "$SERVICE" = 1 ]; then runuser -u "$SVC_USER" -- "$@"; else "$@"; fi; }

if [ "$SERVICE" = 1 ]; then
  id "$SVC_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$SVC_USER" --shell /usr/sbin/nologin "$SVC_USER"
  mkdir -p "$HOME_DIR" "$DATA" "$(dirname "$ENVFILE")"
  chown "$SVC_USER:$SVC_USER" "$HOME_DIR" "$DATA"
else
  mkdir -p "$HOME_DIR" "$DATA" "$(dirname "$ENVFILE")"
fi

# ---- settings file (never overwritten)
if [ ! -f "$ENVFILE" ]; then
  PASS="$(python3 -c 'import secrets; print(secrets.token_urlsafe(15))')"
  sed -e "s|^UNFURL_REPO_URL=.*|UNFURL_REPO_URL=$REPO|" \
      -e "s|^UNFURL_BRANCH=.*|UNFURL_BRANCH=$BRANCH|" \
      -e "s|^UNFURL_PORT=.*|UNFURL_PORT=$PORT|" \
      -e "s|^UNFURL_ALLOWED_HOSTS=.*|UNFURL_ALLOWED_HOSTS=$HOSTS|" \
      -e "s|^UNFURL_AUTH=.*|UNFURL_AUTH=unfurl:$PASS|" \
      "$HERE/unfurl.env.example" >"$ENVFILE"
  if [ "$SERVICE" = 1 ]; then chown "root:$SVC_USER" "$ENVFILE"; chmod 640 "$ENVFILE"; else chmod 600 "$ENVFILE"; fi
  echo "Wrote $ENVFILE with a generated login:  unfurl / $PASS   (change it there any time)"
else
  echo "Keeping your existing $ENVFILE"
fi

# ---- first download (as the service account, so files have the right owner)
echo "Downloading the first version from $REPO ($BRANCH) ..."
# Run the updater from a copy inside the app folder: a clone in someone's private home directory may be unreadable to the service account.
install -m 755 "$HERE/update.sh" "$HOME_DIR/bootstrap-update.sh"
[ "$SERVICE" = 1 ] && chown "$SVC_USER:$SVC_USER" "$HOME_DIR/bootstrap-update.sh"
run_as env UNFURL_HOME="$HOME_DIR" UNFURL_REPO_URL="$REPO" UNFURL_BRANCH="$BRANCH" "$HOME_DIR/bootstrap-update.sh" --no-restart
rm -f "$HOME_DIR/bootstrap-update.sh"
[ -e "$HOME_DIR/current" ] || { echo "Couldn't download a version. If the repository is private, set up a deploy key or token (deploy/README.md) and re-run." >&2; exit 1; }

if [ "$SERVICE" = 0 ]; then
  echo "Prepared $HOME_DIR. Start it with:  set -a; . $ENVFILE; set +a; UNFURL_HOME=$HOME_DIR UNFURL_DATA=$DATA $HOME_DIR/current/deploy/run.sh"
  exit 0
fi

sed -e "s|@USER@|$SVC_USER|g" -e "s|@HOME@|$HOME_DIR|g" -e "s|@DATA@|$DATA|g" -e "s|@ENVFILE@|$ENVFILE|g" "$HERE/unfurl.service" >/etc/systemd/system/unfurl.service
systemctl daemon-reload
systemctl enable --now unfurl
sleep 3
systemctl --no-pager --lines=5 status unfurl || true
echo
echo "Unfurl is running and checks '$BRANCH' for updates every minute."
echo "  open it:         http://${HOSTS%%,*}:$PORT/   (put HTTPS in front of it: deploy/README.md)"
echo "  watch it:        journalctl -u unfurl -f        and        $HOME_DIR/update.log"
echo "  update now:      sudo -u $SVC_USER env UNFURL_HOME=$HOME_DIR $HOME_DIR/current/deploy/update.sh"
echo "  go back one:     sudo -u $SVC_USER env UNFURL_HOME=$HOME_DIR $HOME_DIR/current/deploy/update.sh --rollback"
