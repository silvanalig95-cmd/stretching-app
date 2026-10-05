#!/usr/bin/env python3
"""Unfurl's tiny local server (Python standard library only).

  python3 serve.py            # http://localhost:8765, opens your browser
  python3 serve.py --port 9000 --no-open --data-dir /some/folder

Why a server at all? YouTube refuses to play embedded videos on pages opened
straight from disk (file://), and the app's ES modules need http too. The
server also keeps your history, library and API key in plain JSON files in
./userdata so they survive clearing your browser and work from any browser.

Security: it only listens on 127.0.0.1, only serves the app's own folders, and
its /api endpoints require a custom header plus a matching Host/Origin, so a
random website you have open can't read your API key or overwrite your data.
"""
import argparse
import json
import mimetypes
import os
import sys
import tempfile
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC = {"index.html", "css", "js", "data", "favicon.svg"}  # the only things served
MAX_BODY = 25 * 1024 * 1024
FILES = {"/api/state": "state.json", "/api/config": "config.json"}

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

write_lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    data_dir: Path
    port: int

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---- helpers -----------------------------------------------------------
    def log_message(self, fmt, *args):  # quieter logs: skip the app's constant /api polling
        line = fmt % args
        if "/api/" not in line:
            sys.stderr.write("  %s\n" % line)

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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

    # ---- routing -----------------------------------------------------------
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

    def list_directory(self, path):  # never show folder listings
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_OPTIONS(self):  # no CORS: deliberately refuse preflights
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _api(self, method, path):
        if not self._api_allowed():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        if path == "/api/ping":
            return self._json(HTTPStatus.OK, {"app": "unfurl"})
        name = FILES.get(path)
        if not name:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
        target = self.data_dir / name
        if method == "GET":
            if not target.exists():
                return self._json(HTTPStatus.OK, None)
            try:
                return self._json(HTTPStatus.OK, json.loads(target.read_text("utf-8")))
            except (OSError, ValueError):
                return self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "could not read saved data"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "bad body size"})
        raw = self.rfile.read(length)
        try:
            json.loads(raw)
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "not JSON"})
        with write_lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.data_dir, prefix=name + ".", suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(raw)
                os.replace(tmp, target)  # atomic: a crash can't leave half a file
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            if name == "config.json":
                try:
                    os.chmod(target, 0o600)  # holds your API key
                except OSError:
                    pass
        return self._json(HTTPStatus.OK, {"ok": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data-dir", default=str(ROOT / "userdata"))
    ap.add_argument("--no-open", action="store_true", help="don't open a browser tab")
    args = ap.parse_args()

    Handler.data_dir = Path(args.data_dir).resolve()
    Handler.port = args.port
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        sys.exit(f"Couldn't start on port {args.port}: {e}\nIs Unfurl already running? Try --port {args.port + 1}.")

    url = f"http://localhost:{args.port}/"
    print(f"Unfurl is running at {url}\nYour data is saved in {Handler.data_dir}\nPress Ctrl+C to stop.")
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
