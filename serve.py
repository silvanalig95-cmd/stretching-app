#!/usr/bin/env python3
"""Unfurl's tiny local server (Python standard library only).

  python3 serve.py            # http://localhost:8765, opens your browser
  python3 serve.py --port 9000 --no-open --data-dir /some/folder

Why a server at all? YouTube refuses to play embedded videos on pages opened
straight from disk (file://), and the app's ES modules need http too. The
server also keeps your data in plain JSON files so it survives clearing your
browser and works from any browser.

WHERE YOUR DATA LIVES
  Outside the app folder, in your per-user data directory, so replacing or
  updating the app can never touch it:
    macOS    ~/Library/Application Support/Unfurl
    Windows  %APPDATA%\\Unfurl
    Linux    $XDG_DATA_HOME/unfurl  (default ~/.local/share/unfurl)
  Override with --data-dir or the UNFURL_DATA environment variable.
    profile.json   your library, history, ratings, preferences (small, precious)
    index.json     everything the app has discovered and analysed (rebuildable)
    config.json    your API key (private, mode 600)
    backups/       rolling daily backups of profile.json + one before every
                   data-format upgrade

Security: it only listens on 127.0.0.1, only serves the app's own folders, and
its /api endpoints require a custom header plus a matching Host/Origin, so a
random website you have open can't read your API key or overwrite your data.
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import webbrowser
from datetime import date
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

APP_VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parent
PUBLIC = {"index.html", "css", "js", "data", "favicon.svg"}  # the only things served
MAX_BODY = 40 * 1024 * 1024
DAILY_BACKUPS_KEPT = 30
FILES = {"/api/profile": "profile.json", "/api/index": "index.json", "/api/config": "config.json"}
BACKUP_NAME = re.compile(r"^profile-[A-Za-z0-9._-]+\.json$")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

write_lock = threading.Lock()


# ---------------------------------------------------------------- storage helpers

def default_data_dir() -> Path:
    env = os.environ.get("UNFURL_DATA")
    if env:
        return Path(env).expanduser()
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Unfurl"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / "Unfurl"
    return Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / "unfurl"


def atomic_write(path: Path, raw: bytes, private: bool = False) -> None:
    """Write via a temp file + rename, so a crash can never leave half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if private:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def schema_of(raw: bytes):
    try:
        v = json.loads(raw).get("schema")
        return v if isinstance(v, int) else None
    except (ValueError, AttributeError):
        return None


def list_backups(data_dir: Path):
    bdir = data_dir / "backups"
    if not bdir.is_dir():
        return []
    out = []
    for p in bdir.iterdir():
        if BACKUP_NAME.match(p.name):
            st = p.stat()
            out.append({"name": p.name, "size": st.st_size, "modified": int(st.st_mtime)})
    return sorted(out, key=lambda b: b["modified"], reverse=True)


def snapshot_before_overwrite(data_dir: Path, target: Path, incoming: bytes) -> None:
    """Keep a daily backup, and a dedicated one before any data-format change."""
    if not target.exists():
        return
    bdir = data_dir / "backups"
    bdir.mkdir(parents=True, exist_ok=True)
    existing = target.read_bytes()
    daily = bdir / f"profile-{date.today().isoformat()}.json"
    if not daily.exists():
        shutil.copy2(target, daily)  # state at the end of the previous session
    old, new = schema_of(existing), schema_of(incoming)
    if old != new:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(target, bdir / f"profile-pre-schema{old}-to-{new}-{stamp}.json")
    dailies = sorted(p for p in bdir.iterdir() if re.fullmatch(r"profile-\d{4}-\d\d-\d\d\.json", p.name))
    for p in dailies[:-DAILY_BACKUPS_KEPT]:
        p.unlink()


def read_profile_with_recovery(data_dir: Path):
    """Return (document, recovered_from). A corrupt file is quarantined, never deleted."""
    target = data_dir / "profile.json"
    if not target.exists():
        return None, None
    try:
        return json.loads(target.read_text("utf-8")), None
    except (ValueError, OSError):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        try:
            target.rename(data_dir / f"profile.corrupt-{stamp}.json")
        except OSError:
            pass
        for b in list_backups(data_dir):
            try:
                doc = json.loads((data_dir / "backups" / b["name"]).read_text("utf-8"))
            except (ValueError, OSError):
                continue
            atomic_write(target, json.dumps(doc).encode())
            return doc, b["name"]
        return None, None


def adopt_legacy_data(data_dir: Path, legacy_dir: Path) -> str:
    """First run with a new data location: copy (never move) files from the old ./userdata."""
    if not legacy_dir.is_dir() or legacy_dir.resolve() == data_dir.resolve():
        return ""
    if any((data_dir / n).exists() for n in ("profile.json", "state.json", "config.json")):
        return ""
    copied = []
    for name in ("state.json", "config.json"):
        src = legacy_dir / name
        if src.is_file():
            atomic_write(data_dir / name, src.read_bytes(), private=(name == "config.json"))
            copied.append(name)
    return f"Copied your existing data ({', '.join(copied)}) from {legacy_dir} (the originals were left in place)." if copied else ""


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    data_dir: Path
    port: int

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):  # quieter logs: skip the app's constant /api polling
        line = fmt % args
        if "/api/" not in line:
            sys.stderr.write("  %s\n" % line)

    def _json(self, status, obj, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _api_allowed(self):
        """Reject anything that isn't our own page talking to us."""
        host = self.headers.get("Host", "")
        if host not in (f"localhost:{self.port}", f"127.0.0.1:{self.port}"):
            return False  # DNS-rebinding protection
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://localhost:{self.port}", f"http://127.0.0.1:{self.port}"):
            return False
        return self.headers.get("X-Unfurl") == "1"  # forces a CORS preflight for other sites, which we never answer

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    # ---- routing
    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._api("GET", path)
        parts = [p for p in path.split("/") if p]
        if not parts:
            self.path = "/index.html"
        elif parts[0] not in PUBLIC or ".." in parts:
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_HEAD(self):
        parts = [p for p in urlsplit(self.path).path.split("/") if p]
        if parts and parts[0] not in PUBLIC:
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_PUT(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._api("PUT", path)
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._api("POST", path)
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def list_directory(self, path):  # never show folder listings
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_OPTIONS(self):  # no CORS: deliberately refuse preflights
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- API
    def _api(self, method, path):
        if not self._api_allowed():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        d = self.data_dir
        if path == "/api/ping" and method == "GET":
            return self._json(HTTPStatus.OK, {"app": "unfurl", "version": APP_VERSION, "dataDir": str(d)})

        if path == "/api/legacy" and method == "GET":  # a version-1 state.json, if one is waiting to be migrated
            f = d / "state.json"
            try:
                return self._json(HTTPStatus.OK, json.loads(f.read_text("utf-8")) if f.exists() else None)
            except (ValueError, OSError):
                return self._json(HTTPStatus.OK, None)

        if path == "/api/backups" and method == "GET":
            return self._json(HTTPStatus.OK, list_backups(d))

        if path == "/api/backups/restore" and method == "POST":
            raw = self._body()
            try:
                name = json.loads(raw or b"{}").get("name", "")
            except ValueError:
                name = ""
            if not BACKUP_NAME.match(name) or not (d / "backups" / name).is_file():
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "unknown backup"})
            with write_lock:
                src = d / "backups" / name
                data = src.read_bytes()
                try:
                    json.loads(data)
                except ValueError:
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "that backup is damaged"})
                target = d / "profile.json"
                if target.exists():  # keep what we're replacing
                    shutil.copy2(target, d / "backups" / f"profile-before-restore-{time.strftime('%Y%m%d-%H%M%S')}.json")
                atomic_write(target, data)
            return self._json(HTTPStatus.OK, {"ok": True})

        if path == "/api/backups/snapshot" and method == "POST":  # "keep a copy of my profile as it is right now"
            try:
                label = re.sub(r"[^a-z0-9-]", "", str(json.loads(self._body() or b"{}").get("label", "manual")).lower())[:30] or "manual"
            except ValueError:
                label = "manual"
            src = d / "profile.json"
            if not src.exists():
                return self._json(HTTPStatus.OK, {"ok": True, "name": None})
            (d / "backups").mkdir(parents=True, exist_ok=True)
            name = f"profile-{label}-{time.strftime('%Y%m%d-%H%M%S')}.json"
            with write_lock:
                shutil.copy2(src, d / "backups" / name)
            return self._json(HTTPStatus.OK, {"ok": True, "name": name})

        name = FILES.get(path)
        if not name:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
        target = d / name

        if method == "GET":
            if name == "profile.json":
                doc, recovered = read_profile_with_recovery(d)
                return self._json(HTTPStatus.OK, {"data": doc, "recoveredFrom": recovered})
            if not target.exists():
                return self._json(HTTPStatus.OK, None)
            try:
                return self._json(HTTPStatus.OK, json.loads(target.read_text("utf-8")))
            except (ValueError, OSError):
                return self._json(HTTPStatus.OK, None)  # index/config are rebuildable / re-enterable

        if method != "PUT":
            return self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method"})
        raw = self._body()
        if raw is None:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "bad body size"})
        try:
            json.loads(raw)
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "not JSON"})
        with write_lock:
            if name == "profile.json":
                snapshot_before_overwrite(d, target, raw)
                legacy = d / "state.json"
                if not target.exists() and legacy.exists():  # first profile write: archive the old-format file
                    (d / "backups").mkdir(parents=True, exist_ok=True)
                    os.replace(legacy, d / "backups" / "profile-legacy-state-v1.json")
            atomic_write(target, raw, private=(name == "config.json"))
        return self._json(HTTPStatus.OK, {"ok": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data-dir", default=None, help="where to keep your data (default: your per-user data folder)")
    ap.add_argument("--legacy-dir", default=str(ROOT / "userdata"), help=argparse.SUPPRESS)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser tab")
    args = ap.parse_args()

    data_dir = (Path(args.data_dir).expanduser() if args.data_dir else default_data_dir()).resolve()
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        sys.exit(f"Couldn't create the data folder {data_dir}: {e}\nPick another with: python3 serve.py --data-dir /some/folder")
    note = adopt_legacy_data(data_dir, Path(args.legacy_dir))

    Handler.data_dir = data_dir
    Handler.port = args.port
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        sys.exit(f"Couldn't start on port {args.port}: {e}\nIs Unfurl already running? Try --port {args.port + 1}.")

    url = f"http://localhost:{args.port}/"
    print(f"Unfurl {APP_VERSION} is running at {url}\nYour data is saved in {data_dir}\nPress Ctrl+C to stop.")
    if note:
        print(note)
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
