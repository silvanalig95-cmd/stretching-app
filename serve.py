#!/usr/bin/env python3
"""Unfurl's small server (Python standard library only, no dependencies).

ON YOUR OWN COMPUTER
  python3 serve.py            # http://localhost:8765, opens your browser
  python3 serve.py --port 9000 --no-open --data-dir /some/folder

ON A SERVER (see deploy/README.md for the full guide)
  UNFURL_HOST=0.0.0.0 UNFURL_AUTH=me:a-long-passphrase UNFURL_ALLOWED_HOSTS=unfurl.internal python3 serve.py

Why a server at all? YouTube refuses to play embedded videos on pages opened
straight from disk (file://), and the app's ES modules need http too. The
server also keeps your data in plain JSON files so it survives clearing your
browser, updating the app, and works from any browser or device.

WHERE THE DATA LIVES
  Outside the app folder, in your per-user data directory, so replacing or
  updating the app can never touch it:
    macOS    ~/Library/Application Support/Unfurl
    Windows  %APPDATA%\\Unfurl
    Linux    $XDG_DATA_HOME/unfurl  (default ~/.local/share/unfurl)
  Override with --data-dir or UNFURL_DATA.
    profile.json   your library, history, ratings, preferences (small, precious)
    index.json     everything the app has discovered and analysed (rebuildable)
    config.json    your API key (private, mode 600)
    backups/       rolling daily backups of profile.json + one before every
                   data-format upgrade
  With several users, each gets their own folder under users/.

BACKING UP (to another disk or a cloud drive; see deploy/BACKUP.md)
  python3 serve.py --backup FOLDER [--keep 14] [--small]   one dated unfurl-backup-YYYY-MM-DD.zip of everybody's data, then exit
  python3 serve.py --restore FILE.zip [--force]            put it back (stop the server first)

SETTINGS (environment variables; every one has a command-line flag too)
  UNFURL_HOST             address to listen on          (default 127.0.0.1 = this computer only)
  UNFURL_PORT             port                          (default 8765)
  UNFURL_DATA             data folder
  UNFURL_ALLOWED_HOSTS    comma-separated names people use to reach it, e.g. unfurl.internal,10.0.0.5
  UNFURL_AUTH             "user:password": require a login (HTTP Basic)
  UNFURL_USERS_FILE       file with one "name:password" per line (several users, each with their own library)
  UNFURL_TRUST_PROXY_USER header (e.g. X-Forwarded-User) in which your login proxy / SSO puts the user's name
  UNFURL_YOUTUBE_KEY      a YouTube Data API key kept ON THE SERVER; browsers never see it
  UNFURL_YOUTUBE_KEY_FILE same, read from a file
  UNFURL_USER_DAILY_UNITS per-user daily cap on the shared key, in quota units (default 3000)
  UNFURL_BUILD            a label for this build (default: the git commit)
  UNFURL_POLL_SECONDS     how often open pages check for a new version (default 60)
  Passwords may be plain text or hashed: run  python3 serve.py --hash-password

SECURITY
  By default it only listens on this computer. To listen on the network you must
  turn on a login (or a trusted login proxy): otherwise it refuses to start.
  Pages must be reached through a name in UNFURL_ALLOWED_HOSTS (DNS-rebinding
  protection), /api requires a custom header, other websites cannot talk to it,
  and only the app's own files are served.
"""
import argparse
import errno
import base64
import getpass
import hashlib
import hmac
import http.client
import ipaddress
import socket
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl, urlencode, unquote, quote

APP_VERSION = "0.6.0"
ROOT = Path(__file__).resolve().parent
PUBLIC = {"index.html", "css", "js", "data", "favicon.svg"}  # the only things served
MAX_BODY = 40 * 1024 * 1024
DAILY_BACKUPS_KEPT = 30
SNAPSHOTS_KEPT = 25          # other backups (manual snapshots, before-restore copies) per person; pre-upgrade copies are never pruned
AUTH_CACHE_SECONDS = 300
PROXY_SECRET_HEADER = "X-Unfurl-Proxy-Secret"
FILES = {"/api/profile": "profile.json", "/api/index": "index.json", "/api/config": "config.json"}
BACKUP_NAME = re.compile(r"^profile-[A-Za-z0-9._-]+\.json$")
YT_UPSTREAM = "https://www.googleapis.com/youtube/v3"
YT_COST = {"search": 100, "videos": 1, "commentThreads": 1, "channels": 1, "playlistItems": 1, "playlists": 1}
LOGIN_FAILS_BEFORE_LOCK = 5
LOGIN_LOCK_SECONDS = 60

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

write_lock = threading.Lock()


# ---------------------------------------------------------------- configuration

class Config:
    """Everything the server needs to know, gathered in one place (and testable)."""

    def __init__(self):
        self.host = "127.0.0.1"
        self.port = 8765
        self.data_dir = None            # Path
        self.legacy_dir = ROOT / "userdata"
        self.allowed_hosts = set()      # extra host NAMES (no ports) people may use to reach us
        self.users = {}                 # name -> password spec ("" = no login configured)
        self.trust_proxy_user = None    # header carrying the user's name from a login proxy
        self.proxy_nets = []            # who may act as that proxy (and tell us a visitor's real address)
        self.proxy_secret = ""          # optional: a value the proxy must also send in X-Unfurl-Proxy-Secret
        self.adopt_root_for = ""        # with several users: who inherits the data that was saved before there were several
        self.dummy_spec = ""            # compared against for unknown names, so they cost as much time as real ones
        self.yt_key = ""
        self.yt_upstream = YT_UPSTREAM
        self.user_daily_units = 3000
        self.build = ""
        self.poll_seconds = 60
        self.open_browser = True

    @property
    def per_user(self):
        return bool(self.trust_proxy_user) or len(self.users) > 1

    @property
    def loopback_only(self):
        return self.host in ("127.0.0.1", "localhost", "::1")


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


def git_build() -> str:
    """Which build this is (so open pages can tell when the server was updated): the BUILD file the
    updater writes into every release, or else this checkout's git commit."""
    try:
        stamped = (ROOT / "BUILD").read_text("utf-8").strip()
        if stamped:
            return stamped[:40]
    except OSError:
        pass
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def read_users_file(path: str) -> dict:
    users = {}
    for line in Path(path).expanduser().read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        name, spec = line.split(":", 1)
        if name.strip() and spec:
            users[name.strip()] = spec
    return users


def build_config(args, env) -> Config:
    """Command-line flags win over environment variables, which win over defaults."""
    c = Config()
    pick = lambda flag, key, default=None: flag if flag not in (None, "") else env.get(key, default)  # noqa: E731
    c.host = pick(args.host, "UNFURL_HOST", c.host).strip()
    if "," in c.host or " " in c.host or not c.host:
        sys.exit(f"UNFURL_HOST is the single address the server listens on (0.0.0.0 or 127.0.0.1), but it is set to {c.host!r}.\n"
                 "The names people type in their browser (like the PC's name) belong in UNFURL_ALLOWED_HOSTS instead, and are optional behind a login.")
    c.port = int(pick(args.port, "UNFURL_PORT", c.port))
    d = pick(args.data_dir, "UNFURL_DATA")
    c.data_dir = (Path(d).expanduser() if d else default_data_dir()).resolve()
    c.legacy_dir = Path(args.legacy_dir)
    hosts = pick(",".join(args.allowed_host or []), "UNFURL_ALLOWED_HOSTS", "")
    c.allowed_hosts = {h.strip().lower().split(":")[0] for h in hosts.split(",") if h.strip()}
    uf = pick(args.users_file, "UNFURL_USERS_FILE")
    if uf:
        c.users.update(read_users_file(uf))
    # Several people in one setting: UNFURL_USERS=anna:secret;ben:pbkdf2-sha256:200000:...  (';' or new lines between people)
    for entry in re.split(r"[;\n]+", env.get("UNFURL_USERS", "")):
        entry = entry.strip()
        if not entry:
            continue
        uname, _, uspec = entry.partition(":")
        uspec = uspec.strip()   # stray spaces around a password in a settings file are never meant
        if not uname.strip() or not uspec:
            sys.exit(f"UNFURL_USERS has an entry that doesn't look like  name:password  ({uname.strip() or entry[:20]!r}). "
                     "Separate people with ';' and give each a non-empty password (or hash).")
        c.users[uname.strip()] = uspec
    auth = env.get("UNFURL_AUTH", "")
    if auth:
        name, _, spec = auth.partition(":")
        if not name or not spec:
            sys.exit("UNFURL_AUTH must look like  name:password  (neither part may be empty). "
                     "If it comes from an environment file, check that the variable it reads is set.")
        c.users[name] = spec
    c.adopt_root_for = env.get("UNFURL_ADOPT_ROOT_DATA_FOR", "").strip()
    c.proxy_secret = env.get("UNFURL_PROXY_SECRET", "")
    c.dummy_spec = next((sp for sp in c.users.values() if sp.startswith(PBKDF2_PREFIXES)), "x" * 16)
    c.trust_proxy_user = pick(args.trust_proxy_user, "UNFURL_TRUST_PROXY_USER") or None
    c.proxy_nets = parse_nets(env.get("UNFURL_PROXY_IPS", "127.0.0.1,::1"))
    kf = env.get("UNFURL_YOUTUBE_KEY_FILE")
    c.yt_key = (Path(kf).expanduser().read_text("utf-8").strip() if kf else env.get("UNFURL_YOUTUBE_KEY", "")).strip()
    c.yt_upstream = env.get("UNFURL_YT_UPSTREAM", YT_UPSTREAM).rstrip("/")
    c.user_daily_units = int(env.get("UNFURL_USER_DAILY_UNITS", c.user_daily_units))
    c.build = env.get("UNFURL_BUILD") or git_build()
    c.poll_seconds = int(env.get("UNFURL_POLL_SECONDS", c.poll_seconds))
    c.open_browser = not args.no_open
    return c


LOCAL_SUFFIXES = (".local", ".lan", ".home.arpa", ".internal", ".localdomain")


def is_local_name(hostname: str) -> bool:
    """Names that can only point inside a private network: IP addresses, bare computer names ("mypc"), and the
    suffixes reserved for home/office networks. Nobody on the internet can make such a name point at your machine,
    which is what DNS-rebinding protection is about, so once a login is required they need no listing."""
    h = hostname.strip("[]").lower()
    if not h:
        return False
    try:
        ipaddress.ip_address(h)
        return True
    except ValueError:
        pass
    return "." not in h or h.endswith(LOCAL_SUFFIXES)


def parse_nets(text: str):
    nets = []
    for part in (text or "").split(","):
        part = part.strip()
        if part:
            nets.append(ipaddress.ip_network(part, strict=False))
    return nets


def check_exposure(c: Config):
    """Refuse the one dangerous combination: reachable from the network with no login at all."""
    if not c.loopback_only and not c.users and not c.trust_proxy_user:
        return (
            f"Refusing to listen on {c.host} without a login: anyone who can reach this address could read and change "
            "your data and use your YouTube key.\n"
            "Set UNFURL_AUTH=name:password (or UNFURL_USERS_FILE, or UNFURL_TRUST_PROXY_USER if a login proxy sits in front), "
            "or listen on 127.0.0.1 only.\n"
            "(If you already set UNFURL_AUTH in a settings file, look for a second, empty UNFURL_AUTH= line further down: "
            "when a name appears twice, the LAST one wins.)"
        )
    return None


# ---------------------------------------------------------------- passwords and logins

PBKDF2_PREFIXES = ("pbkdf2-sha256:", "pbkdf2_sha256$")   # the second is the older spelling; '$' gets mangled by docker compose and shells


def hash_password(password: str, iterations: int = 200_000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "pbkdf2-sha256:{}:{}:{}".format(iterations, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def check_password(spec: str, given: str) -> bool:
    """spec is either 'pbkdf2-sha256:iterations:salt:hash' or a plain password. Constant-time compare."""
    if spec.startswith(PBKDF2_PREFIXES):
        try:
            _, it, salt, want = spec.split(spec[len("pbkdf2-sha256")])
            dk = hashlib.pbkdf2_hmac("sha256", given.encode(), base64.b64decode(salt), int(it))
            return hmac.compare_digest(dk, base64.b64decode(want))
        except (ValueError, TypeError):
            return False
    return hmac.compare_digest(spec.encode(), given.encode())


def safe_user_dir(name: str) -> str:
    """A folder name for a login. Names that are already plain lowercase letters/digits/._- are used as they are;
    anything else gets a short fingerprint of the real name, so two different logins (say "Ana" and "ana", or
    "a b" and "a_b") can never end up sharing a folder, even on a case-insensitive disk."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:48].strip(".")
    if cleaned and cleaned == name and name == name.lower():
        return name
    return f"{(cleaned or 'user').lower()}-{hashlib.sha256(name.encode()).hexdigest()[:10]}"


# ---------------------------------------------------------------- storage helpers

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
        atomic_write(daily, existing)  # state at the end of the previous session (atomic: a full disk must not leave a half copy that blocks the real one)
    old, new = schema_of(existing), schema_of(incoming)
    if old != new:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        atomic_write(bdir / f"profile-pre-schema{old}-to-{new}-{stamp}.json", existing)
    dailies = sorted(p for p in bdir.iterdir() if re.fullmatch(r"profile-\d{4}-\d\d-\d\d\.json", p.name))
    for p in dailies[:-DAILY_BACKUPS_KEPT]:
        p.unlink()


def prune_snapshots(data_dir: Path) -> None:
    """Manual snapshots and before-restore copies are capped (daily and pre-upgrade backups are handled elsewhere),
    so no one can fill the disk by pressing a button repeatedly."""
    bdir = data_dir / "backups"
    keep_forever = re.compile(r"profile-(\d{4}-\d\d-\d\d|pre-schema.*|legacy-state-v1)\.json")
    extras = sorted((p for p in bdir.iterdir() if BACKUP_NAME.match(p.name) and not keep_forever.fullmatch(p.name)), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in extras[SNAPSHOTS_KEPT:]:
        p.unlink(missing_ok=True)


def profile_rev(raw: bytes) -> str:
    """A short fingerprint of the saved profile; a page sends it back to prove it saw the latest version."""
    return hashlib.sha1(raw).hexdigest()[:16]


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


def adopt_root_data(c: Config) -> str:
    """Moving from one shared login to several: give the data saved so far to one named person (copied, never moved,
    and never over something they already have)."""
    name = c.adopt_root_for
    if not name or not c.per_user:
        return ""
    if name not in c.users and not c.trust_proxy_user:
        sys.exit(f"UNFURL_ADOPT_ROOT_DATA_FOR={name!r} is not one of the logins ({', '.join(sorted(c.users)) or 'none'}).")
    dest = c.data_dir / "users" / safe_user_dir(name)
    if (dest / "profile.json").exists() or not (c.data_dir / "profile.json").exists():
        return ""
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    for f in ("profile.json", "index.json", "config.json"):
        src = c.data_dir / f
        if src.exists() and not (dest / f).exists():
            atomic_write(dest / f, src.read_bytes(), private=(f == "config.json"))
            copied.append(f)
    return f"Gave the existing data ({', '.join(copied)}) to {name} (copied into {dest}; the originals were left in place)." if copied else ""


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


# ---------------------------------------------------------------- shared-key YouTube proxy usage

class UsageMeter:
    """Per-user daily quota units spent through the server's shared YouTube key (YouTube's day is Pacific time).

    Kept in <data dir>/usage.json so that restarting the server (every update does) can't hand out a fresh allowance."""

    def __init__(self, path=None):
        self.lock = threading.Lock()
        self.path = path
        self.day = self.today()
        self.used = {}
        if path and Path(path).exists():
            try:
                saved = json.loads(Path(path).read_text("utf-8"))
                if saved.get("day") == self.day:
                    self.used = {str(k): int(v) for k, v in saved.get("used", {}).items()}
            except (ValueError, OSError, AttributeError, TypeError):
                pass  # a damaged counter file just starts the day's count again

    @staticmethod
    def today():
        return (datetime.now(timezone.utc) - timedelta(hours=8)).date().isoformat()

    def charge(self, user, units, cap):
        with self.lock:
            if self.day != self.today():
                self.day, self.used = self.today(), {}
            key = user or ""
            if self.used.get(key, 0) + units > cap:
                return False
            self.used[key] = self.used.get(key, 0) + units
            if self.path:
                try:
                    atomic_write(Path(self.path), json.dumps({"day": self.day, "used": self.used}).encode())
                except OSError:
                    pass  # counting is best effort; never fail a request over it
            return True


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    cfg: Config
    usage = UsageMeter()   # replaced in main() with one that lives in the data folder
    failures = {}   # ip -> [count, locked_until, window_start]
    auth_cache = {}  # sha256(Authorization header) -> (name, valid_until); only successful logins

    def __init__(self, *args, **kwargs):
        self.user = None
        self.bad_host = ""
        super().__init__(*args, directory=str(ROOT), **kwargs)

    quiet = False
    timeout = 60   # drop connections that sit idle, so a few stalled clients can't tie the server up

    def log_message(self, fmt, *args):  # quieter logs: skip the app's constant /api polling
        if self.quiet:
            return
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

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")  # YouTube embeds need the referrer
        super().end_headers()

    # ---- who is this, and are they allowed?
    def _from_proxy(self) -> bool:
        try:
            ip = ipaddress.ip_address(self.client_address[0].split("%")[0])
        except ValueError:
            return False
        if not any(ip in n for n in self.cfg.proxy_nets):
            return False
        secret = self.cfg.proxy_secret
        return not secret or hmac.compare_digest(secret.encode(), (self.headers.get(PROXY_SECRET_HEADER) or "").encode())

    def _visitor_ip(self) -> str:
        """The address to count login failures against: the real visitor when a proxy we trust tells us who it is."""
        peer = self.client_address[0]
        fwd = self.headers.get("X-Forwarded-For")
        if fwd and self._from_proxy():
            return fwd.split(",")[-1].strip() or peer  # the rightmost entry is the one OUR proxy appended
        return peer

    def _challenge(self, status=HTTPStatus.UNAUTHORIZED, message="Login required"):
        body = message.encode()
        self.send_response(status)
        if status == HTTPStatus.UNAUTHORIZED:
            self.send_header("WWW-Authenticate", 'Basic realm="Unfurl", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _authenticate(self) -> bool:
        """Sets self.user. Returns False (after answering) if the request may not continue."""
        c = self.cfg
        if c.trust_proxy_user:
            if not self._from_proxy():  # a header anyone could forge is worthless unless it came from the proxy itself
                self._challenge(HTTPStatus.FORBIDDEN, "Reach this server through its login proxy.")
                return False
            name = (self.headers.get(c.trust_proxy_user) or "").strip()
            if not name:
                self._challenge(HTTPStatus.UNAUTHORIZED, "No user identified by the login proxy.")
                return False
            self.user = name
            return True
        if not c.users:
            return True
        ip = self._visitor_ip()
        now = time.time()
        if len(self.failures) > 500:  # don't let a scan grow this forever
            for k in [k for k, v in self.failures.items() if v[1] < now and now - v[2] > LOGIN_LOCK_SECONDS]:
                del self.failures[k]
        fails = self.failures.get(ip, [0, 0.0, now])
        if fails[1] <= now and now - fails[2] > LOGIN_LOCK_SECONDS:  # an old streak of mistakes doesn't count against you
            fails = [0, 0.0, now]
        if fails[1] > now:
            self._challenge(HTTPStatus.TOO_MANY_REQUESTS, "Too many failed logins. Try again in a minute.")
            return False
        header = self.headers.get("Authorization", "")
        cache_key = hashlib.sha256(header.encode()).digest() if header.startswith("Basic ") else None
        hit = self.auth_cache.get(cache_key) if cache_key else None
        if hit and hit[1] > now:   # a login that checked out moments ago: a page load makes ~20 requests, don't re-hash for each
            self.failures.pop(ip, None)
            self.user = hit[0]
            return True
        if header.startswith("Basic "):
            try:
                name, _, given = base64.b64decode(header[6:]).decode("utf-8").partition(":")
            except (ValueError, UnicodeDecodeError):
                name, given = "", ""
            spec = c.users.get(name)
            # compare even for unknown names (against a hash of the same cost), so response time doesn't reveal which names exist
            ok = check_password(spec if spec is not None else c.dummy_spec, given) and spec is not None
            if ok:
                self.failures.pop(ip, None)
                self.user = name
                if len(self.auth_cache) > 200:
                    self.auth_cache.clear()
                self.auth_cache[cache_key] = (name, now + AUTH_CACHE_SECONDS)
                return True
            count = fails[0] + 1
            self.failures[ip] = [count, now + LOGIN_LOCK_SECONDS if count >= LOGIN_FAILS_BEFORE_LOCK else 0.0, fails[2]]
        self._challenge()
        return False

    def _name_allowed(self, hostname: str) -> bool:
        c = self.cfg
        if hostname in {"localhost", "127.0.0.1", "[::1]"} or hostname in c.allowed_hosts:
            return True
        for a in c.allowed_hosts:  # "*.example.com" or ".example.com": any name ending that way
            if (a.startswith("*.") or a.startswith(".")) and hostname.endswith(a.lstrip("*")):
                return True
        # With a login in front, names that can only exist on a private network are fine without being listed.
        return bool((c.users or c.trust_proxy_user) and is_local_name(hostname))

    def _host_ok(self) -> bool:
        """DNS-rebinding protection: only the names we expect may be used to reach the API."""
        host = (self.headers.get("Host") or "").lower()
        hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        self.bad_host = host
        if not self._name_allowed(hostname):
            return False
        origin = self.headers.get("Origin")
        if origin:
            o = urlsplit(origin)
            oh = f"[{o.hostname}]" if o.hostname and ":" in o.hostname else (o.hostname or "")
            if not self._name_allowed(oh.lower()):
                self.bad_host = oh.lower()
                return False
        return True

    def _api_allowed(self) -> bool:
        return self._host_ok() and self.headers.get("X-Unfurl") == "1"  # the header forces a CORS preflight for other sites, which we never answer

    @property
    def data_dir(self) -> Path:
        c = self.cfg
        return c.data_dir / "users" / safe_user_dir(self.user) if (c.per_user and self.user) else c.data_dir

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    # ---- routing
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/healthz":  # for the updater and container health checks: no login, nothing private
            return self._json(HTTPStatus.OK, {"ok": True, "app": "unfurl", "version": APP_VERSION, "build": self.cfg.build})
        if not self._authenticate():
            return
        if path.startswith("/api/"):
            return self._api("GET", path)
        safe = self._static_path(path)
        if safe is None:
            return self.send_error(HTTPStatus.NOT_FOUND)
        self.path = quote(safe)  # re-encode: the base class decodes once more, and must see exactly what was vetted
        return super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path == "/healthz":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self._authenticate():
            return
        safe = self._static_path(urlsplit(self.path).path)
        if safe is None:
            return self.send_error(HTTPStatus.NOT_FOUND)
        self.path = quote(safe)
        return super().do_HEAD()

    @staticmethod
    def _static_path(raw_path):
        """Map a request path to one of the app's public files, or None. Decodes %XX FIRST and refuses any
        '..', so '/css/%2e%2e/serve.py' can't climb out of the public folders."""
        decoded = unquote(raw_path)
        if "\x00" in decoded or "\\" in decoded:
            return None
        parts = [p for p in decoded.split("/") if p]
        if any(p in (".", "..") for p in parts):
            return None
        if not parts:
            return "/index.html"
        if parts[0] not in PUBLIC:
            return None
        return "/" + "/".join(parts) + ("/" if decoded.endswith("/") else "")   # keep a trailing slash, or folders redirect forever

    def translate_path(self, path):  # belt and braces: whatever the above allowed must really lie inside the app folder
        full = super().translate_path(path)
        try:
            Path(full).resolve().relative_to(ROOT)
        except ValueError:
            return str(ROOT / "__not_found__")
        return full

    def do_PUT(self):
        if not self._authenticate():
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._api("PUT", path)
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_POST(self):
        if not self._authenticate():
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._api("POST", path)
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def list_directory(self, path):  # never show folder listings
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_OPTIONS(self):  # no CORS: deliberately refuse preflights
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    # ---- API
    def _api(self, method, path):
        if not self._api_allowed():
            if not self._host_ok():   # say WHICH name was refused and which are accepted, so the page can tell the person
                return self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden", "reason": "host", "host": self.bad_host, "allowed": sorted(self.cfg.allowed_hosts)})
            return self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden", "reason": "header"})
        c, d = self.cfg, self.data_dir
        if path == "/api/ping" and method == "GET":
            info = {
                "app": "unfurl", "version": APP_VERSION, "build": c.build, "pollSeconds": c.poll_seconds,
                "ytProxy": bool(c.yt_key), "ytDailyUnits": c.user_daily_units if c.yt_key else 0, "user": self.user, "multiUser": c.per_user,
            }
            if not (c.per_user or c.users or c.trust_proxy_user):  # server paths are for the owner at their own computer, not for logged-in visitors
                info["dataDir"] = str(d)
            return self._json(HTTPStatus.OK, info)

        if path.startswith("/api/yt/") and method == "GET":
            return self._youtube_proxy(path[len("/api/yt/"):])

        d.mkdir(parents=True, exist_ok=True)
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
                body = json.loads(raw or b"{}")
                name = body.get("name", "") if isinstance(body, dict) else ""
            except ValueError:
                name = ""
            if not isinstance(name, str) or not BACKUP_NAME.match(name) or not (d / "backups" / name).is_file():
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "unknown backup"})
            with write_lock:
                src = d / "backups" / name
                data = src.read_bytes()
                try:
                    json.loads(data)
                except ValueError:
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "that backup is damaged"})
                target = d / "profile.json"
                try:
                    if target.exists():  # keep what we're replacing
                        atomic_write(d / "backups" / f"profile-before-restore-{time.strftime('%Y%m%d-%H%M%S')}.json", target.read_bytes())
                    atomic_write(target, data)
                    prune_snapshots(d)
                except OSError as e:
                    return self._json(HTTPStatus.INSUFFICIENT_STORAGE, {"error": f"couldn't restore ({e.strerror or e})"})
            return self._json(HTTPStatus.OK, {"ok": True})

        if path == "/api/backups/snapshot" and method == "POST":  # "keep a copy of my profile as it is right now"
            try:
                body = json.loads(self._body() or b"{}")
                label = re.sub(r"[^a-z0-9-]", "", str(body.get("label", "manual") if isinstance(body, dict) else "manual").lower())[:30] or "manual"
            except ValueError:
                label = "manual"
            src = d / "profile.json"
            if not src.exists():
                return self._json(HTTPStatus.OK, {"ok": True, "name": None})
            (d / "backups").mkdir(parents=True, exist_ok=True)
            name = f"profile-{label}-{time.strftime('%Y%m%d-%H%M%S')}.json"
            try:
                with write_lock:
                    atomic_write(d / "backups" / name, src.read_bytes())
                    prune_snapshots(d)
            except OSError as e:
                return self._json(HTTPStatus.INSUFFICIENT_STORAGE, {"error": f"couldn't write the backup ({e.strerror or e})"})
            return self._json(HTTPStatus.OK, {"ok": True, "name": name})

        name = FILES.get(path)
        if not name:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
        target = d / name

        if method == "GET":
            if name == "profile.json":
                doc, recovered = read_profile_with_recovery(d)
                rev = profile_rev(target.read_bytes()) if target.exists() else None
                return self._json(HTTPStatus.OK, {"data": doc, "recoveredFrom": recovered, "rev": rev})
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
        try:
            with write_lock:
                if name == "profile.json":
                    # Optimistic concurrency: a page that was opened before another tab or device saved must not
                    # silently overwrite that work. It sends the revision it last saw; if the file has moved on, we say so.
                    want = self.headers.get("If-Match")
                    have = profile_rev(target.read_bytes()) if target.exists() else "none"
                    if want is not None and want != have:
                        try:
                            current = json.loads(target.read_text("utf-8"))
                        except (ValueError, OSError):
                            current = None
                        return self._json(HTTPStatus.CONFLICT, {"error": "conflict", "rev": None if have == "none" else have, "data": current})
                    snapshot_before_overwrite(d, target, raw)
                    legacy = d / "state.json"
                    if not target.exists() and legacy.exists():  # first profile write: archive the old-format file
                        (d / "backups").mkdir(parents=True, exist_ok=True)
                        os.replace(legacy, d / "backups" / "profile-legacy-state-v1.json")
                atomic_write(target, raw, private=(name == "config.json"))
        except OSError as e:   # disk full, read-only folder...: say so instead of dropping the connection
            return self._json(HTTPStatus.INSUFFICIENT_STORAGE, {"error": f"couldn't save ({e.strerror or e})"})
        return self._json(HTTPStatus.OK, {"ok": True, "rev": profile_rev(raw) if name == "profile.json" else None})

    def _youtube_proxy(self, endpoint):
        """Forward a YouTube Data API call using the server's key, so browsers never hold it."""
        c = self.cfg
        if not c.yt_key:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "this server has no shared YouTube key"})
        if endpoint not in YT_COST:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown YouTube endpoint"})
        parsed = urlsplit(self.path)
        if len(parsed.query) > 4000:
            return self._json(HTTPStatus.REQUEST_URI_TOO_LONG, {"error": "query too long"})
        params = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False) if k != "key"]
        if not self.usage.charge(self.user, YT_COST[endpoint], c.user_daily_units):
            return self._json(HTTPStatus.FORBIDDEN, {"error": {
                "code": 403, "message": "Your share of today's YouTube allowance on this server is used up.",
                "errors": [{"reason": "quotaExceeded", "domain": "unfurl"}]}})
        url = f"{c.yt_upstream}/{endpoint}?{urlencode(params + [('key', c.yt_key)])}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"Unfurl/{APP_VERSION}", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                body, status = resp.read(), resp.status
        except urllib.error.HTTPError as e:   # Google's own error body (quota, bad request ...) passes straight through
            body, status = e.read(), e.code
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            return self._json(HTTPStatus.BAD_GATEWAY, {"error": {"code": 502, "message": f"The server couldn't reach YouTube ({e})."}})
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def port_in_use(host: str, port: int) -> bool:
    """Is something already answering on this port? (On Windows two programs can quietly bind the very same port,
    so the operating system's own "address in use" error can't be relied on to warn us.)"""
    probe = {"0.0.0.0": "127.0.0.1", "": "127.0.0.1", "::": "::1"}.get(host, host)
    try:
        with socket.create_connection((probe, port), timeout=0.7):
            return True
    except OSError:
        return False


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, handler):
        if ":" in addr[0]:   # an IPv6 address such as "::" or "::1"
            self.address_family = socket.AF_INET6
        super().__init__(addr, handler)


# ---------------------------------------------------------------- self-test (used by the updater before it switches versions)

def selftest() -> int:
    """Start a throwaway server on this code and check it really serves the app and stores data."""
    problems = []
    tmp = Path(tempfile.mkdtemp(prefix="unfurl-selftest-"))
    c = Config()
    c.data_dir = tmp
    c.legacy_dir = tmp / "none"
    c.build = "selftest"
    Handler.cfg = c
    Handler.quiet = True
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    c.port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def get(path, method="GET", body=None, api=False):
        conn = http.client.HTTPConnection("127.0.0.1", c.port, timeout=10)
        headers = {"X-Unfurl": "1", "Content-Type": "application/json"} if api else {}
        conn.request(method, path, body=body, headers=headers)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, r.getheader("Content-Type", ""), data

    def expect(cond, what):
        if not cond:
            problems.append(what)

    try:
        st, ct, body = get("/")
        expect(st == 200 and b"<title>" in body, f"/ should serve index.html (got {st})")
        refs = re.findall(rb'(?:src|href)="((?:js|css)/[^"]+|favicon\.svg)"', body)
        expect(len(refs) >= 2, "index.html should reference its script and stylesheet")
        for ref in refs:
            st, ct, _ = get("/" + ref.decode())
            expect(st == 200, f"{ref.decode()} should be served (got {st})")
        for must in ("/js/app.js", "/js/ctx.js", "/js/state.js", "/css/style.css", "/data/suggestions.js"):
            st, ct, _ = get(must)
            expect(st == 200, f"{must} should be served (got {st})")
        st, ct, _ = get("/js/app.js")
        expect("javascript" in ct, f"JavaScript must be served as a script, not {ct!r}")
        for hidden in ("/serve.py", "/.git/config", "/deploy/update.sh", "/BUILD", "/tests/unit/server.test.js", "/css/%2e%2e/serve.py", "/css/..%2fserve.py", "/js/%2e%2e/deploy/update.sh", "/css/%2e%2e/.git/config", "/css/%5c..%5cserve.py", "/css/%252e%252e/serve.py", "/css/%252e%252e%252fserve.py", "/%2e%2e/serve.py"):
            st, _, _ = get(hidden)
            expect(st == 404, f"{hidden} must not be served (got {st})")
        st, _, body = get("/healthz")
        expect(st == 200 and json.loads(body).get("ok") is True, "/healthz should answer without a login")
        st, _, body = get("/api/ping", api=True)
        expect(st == 200 and json.loads(body).get("app") == "unfurl", "ping should identify the app")
        st, _, _ = get("/api/profile")
        expect(st == 403, "the API must refuse requests without the app's header")
        st, _, _ = get("/api/profile", method="PUT", body=json.dumps({"schema": 2, "probe": True}), api=True)
        expect(st == 200, f"saving data should work (got {st})")
        st, _, body = get("/api/profile", api=True)
        expect(st == 200 and json.loads(body)["data"]["probe"] is True, "saved data should read back")
    except Exception as e:   # noqa: BLE001 - any failure means the build is not fit to deploy
        problems.append(f"unexpected error: {e!r}")
    finally:
        httpd.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    for p in problems:
        print(f"selftest FAILED: {p}", file=sys.stderr)
    if not problems:
        print(f"selftest ok (Unfurl {APP_VERSION})")
    return 1 if problems else 0


# ---------------------------------------------------------------- whole-folder backups (for another disk or a cloud drive)

ARCHIVE_NAME = re.compile(r"^unfurl-backup-\d{4}-\d{2}-\d{2}\.zip$")
_USER = r"users/[a-z0-9_-][a-z0-9._-]{0,63}/"
RESTORABLE = re.compile(rf"^(?:{_USER})?(?:(?:profile|index|config|usage)\.json|backups/profile-[A-Za-z0-9._-]+\.json)$")
USER_FOLDER = re.compile(r"^[a-z0-9_-][a-z0-9._-]{0,63}$")
RECENT_COPIES = 3            # of the app's own rolling profile backups, per person, that go into the archive
MAX_RESTORE_BYTES = 4 << 30


def backup_sources(data_dir: Path, small: bool = False):
    """(path inside the archive, file) for everything worth keeping, for every person.
    Not included: temp files, damaged copies, and all but the newest few rolling backups (the archive itself is the history)."""
    found = []

    def folder(path: Path, prefix: str):
        for name in ("profile.json", "config.json", "usage.json") + (() if small else ("index.json",)):
            f = path / name
            if f.is_file() and not f.is_symlink():
                found.append((prefix + name, f))
        bdir = path / "backups"
        if bdir.is_dir() and not bdir.is_symlink():
            newest = sorted((p for p in bdir.iterdir() if BACKUP_NAME.match(p.name) and p.is_file() and not p.is_symlink()),
                            key=lambda p: p.stat().st_mtime, reverse=True)[:RECENT_COPIES]
            found.extend((f"{prefix}backups/{p.name}", p) for p in newest)

    folder(data_dir, "")
    users = data_dir / "users"
    if users.is_dir() and not users.is_symlink():
        for u in sorted(users.iterdir()):
            if u.is_dir() and not u.is_symlink() and USER_FOLDER.match(u.name):
                folder(u, f"users/{u.name}/")
    return found


def make_backup(data_dir: Path, dest: Path, keep: int = 14, small: bool = False) -> str:
    """One zip per day (`unfurl-backup-YYYY-MM-DD.zip`) in `dest`; running again the same day replaces it.
    Written to a temporary name and renamed, so a sync tool never sees half a file. Older archives beyond `keep` are
    removed, but only ones with exactly this name pattern: nothing else in `dest` is ever touched."""
    files = backup_sources(data_dir, small)
    if not any(arc.endswith("profile.json") for arc, _ in files):
        sys.exit(f"Nothing to back up: there is no profile.json in {data_dir} (or in its users/ folders).\n"
                 "Is this the right data folder? Docker uses the data volume (see deploy/BACKUP.md); otherwise pass --data-dir.")
    if keep < 1:
        sys.exit("--keep must be at least 1.")
    try:
        dest.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=dest, prefix=".unfurl-backup-", suffix=".part")
    except OSError as e:
        sys.exit(f"Can't write to {dest}: {e}")
    final = dest / f"unfurl-backup-{time.strftime('%Y-%m-%d')}.zip"
    warnings = []
    try:
        with os.fdopen(fd, "wb") as raw, zipfile.ZipFile(raw, "w", zipfile.ZIP_DEFLATED) as z:
            for arc, src in files:
                if arc.endswith("/profile.json") or arc == "profile.json":
                    try:
                        json.loads(src.read_bytes())
                    except ValueError:
                        warnings.append(f"{arc} is damaged; it was saved anyway, together with the app's most recent automatic copies")
                z.write(src, arc)
            z.writestr("MANIFEST.json", json.dumps({
                "app": "unfurl", "version": APP_VERSION, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "small": small, "files": [a for a, _ in files],
            }, indent=1))
        with zipfile.ZipFile(tmp) as check:
            bad = check.testzip()
            if bad:
                sys.exit(f"The new archive failed its own check ({bad}); nothing was kept.")
        os.replace(tmp, final)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    removed = 0
    archives = sorted(p for p in dest.iterdir() if ARCHIVE_NAME.match(p.name) and p.is_file())
    for old in archives[:-keep]:
        try:
            old.unlink()
            removed += 1
        except OSError:
            pass
    people = sorted({a.split("/")[1] for a, _ in files if a.startswith("users/")})
    size = final.stat().st_size
    lines = [f"Saved {final} ({size / 1_048_576:.1f} MB; {len(files)} files"
             f"{f', {len(people)} people' if people else ''}{', without the rebuildable index' if small else ''})."]
    lines.append(f"Keeping the newest {keep} backup{'s' if keep != 1 else ''}{f' (removed {removed} older)' if removed else ''}.")
    lines += [f"WARNING: {w}" for w in warnings]
    return "\n".join(lines)


def restore_backup(archive: Path, data_dir: Path, force: bool = False) -> str:
    """Put an archive made by make_backup back into the data folder. Stop the server first.
    Only the file names a backup can contain are accepted (nothing can land outside the data folder)."""
    try:
        z = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as e:
        sys.exit(f"Can't read {archive} as a backup: {e}. Nothing was changed.")
    with z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        wanted = [i for i in infos if i.filename != "MANIFEST.json"]
        stray = [i.filename for i in wanted if not RESTORABLE.match(i.filename)]
        if stray:
            sys.exit(f"This doesn't look like an Unfurl backup (it contains {stray[0]!r}). Nothing was changed.")
        if not any(i.filename.endswith("profile.json") for i in wanted):
            sys.exit("This archive has no profile.json, so there is nothing to restore. Nothing was changed.")
        if sum(i.file_size for i in wanted) > MAX_RESTORE_BYTES:
            sys.exit("This archive is far larger than any Unfurl backup. Nothing was changed.")
        bad = z.testzip()
        if bad:
            sys.exit(f"{archive} is damaged ({bad}). Nothing was changed.")
        data_dir.mkdir(parents=True, exist_ok=True)
        current = [n for n in ("profile.json", "index.json", "config.json", "usage.json", "users") if (data_dir / n).exists()]
        aside = None
        if current:
            if not force:
                sys.exit(f"{data_dir} already holds data ({', '.join(current)}). Restore into an empty folder, or add --force to move the "
                         "current files aside first (into a before-restore-… folder next to them). Nothing was changed.")
            aside = data_dir / f"before-restore-{time.strftime('%Y%m%d-%H%M%S')}"
            aside.mkdir()
            for n in current:
                shutil.move(str(data_dir / n), str(aside / n))
        for i in wanted:
            atomic_write(data_dir.joinpath(*i.filename.split("/")), z.read(i), private=i.filename.endswith("config.json"))
    people = sorted({i.filename.split("/")[1] for i in wanted if i.filename.startswith("users/")})
    msg = f"Restored {len(wanted)} files{f' for {len(people)} people' if people else ''} from {archive} into {data_dir}."
    if aside:
        msg += f"\nThe files that were there before were moved to {aside}."
    return msg + "\nStart Unfurl again; everything is as it was when the backup was made."


# ---------------------------------------------------------------- main

def main(argv=None, env=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=None, help="address to listen on (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--data-dir", default=None, help="where to keep your data (default: your per-user data folder)")
    ap.add_argument("--allowed-host", action="append", help="a name people use to reach this server (repeatable)")
    ap.add_argument("--users-file", default=None, help="file with one name:password per line")
    ap.add_argument("--trust-proxy-user", default=None, help="header in which a login proxy passes the user's name")
    ap.add_argument("--legacy-dir", default=str(ROOT / "userdata"), help=argparse.SUPPRESS)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser tab")
    ap.add_argument("--selftest", action="store_true", help="check this copy of the app works, then exit")
    ap.add_argument("--hash-password", action="store_true", help="print a hashed password for UNFURL_AUTH / the users file")
    ap.add_argument("--backup", metavar="FOLDER", default=None, help="save a dated .zip of all the data into FOLDER, then exit (see deploy/BACKUP.md)")
    ap.add_argument("--keep", type=int, default=14, help="with --backup: how many daily archives to keep in FOLDER (default 14)")
    ap.add_argument("--small", action="store_true", help="with --backup: leave out index.json (rebuildable, but costs YouTube quota to re-fetch)")
    ap.add_argument("--restore", metavar="ZIPFILE", default=None, help="put a backup made with --backup back into the data folder (stop the server first), then exit")
    ap.add_argument("--force", action="store_true", help="with --restore: move data already in the folder aside instead of refusing")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env

    if args.selftest:
        sys.exit(selftest())
    if args.hash_password:
        pw = getpass.getpass("Password to hash: ")
        if pw != getpass.getpass("Again: "):
            sys.exit("The two passwords differ.")
        print(hash_password(pw))
        return
    if args.backup is not None or args.restore is not None:
        if args.backup is not None and args.restore is not None:
            sys.exit("Use --backup or --restore, one at a time.")
        d = args.data_dir or env.get("UNFURL_DATA")
        data_dir = (Path(d).expanduser() if d else default_data_dir()).resolve()
        if args.backup is not None:
            print(make_backup(data_dir, Path(args.backup).expanduser().resolve(), keep=args.keep, small=args.small))
        else:
            print(restore_backup(Path(args.restore).expanduser(), data_dir, force=args.force))
        return

    c = build_config(args, env)
    problem = check_exposure(c)
    if problem:
        sys.exit(problem)
    try:
        c.data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        sys.exit(f"Couldn't create the data folder {c.data_dir}: {e}\nPick another with: python3 serve.py --data-dir /some/folder")
    note = "" if c.per_user else adopt_legacy_data(c.data_dir, c.legacy_dir)
    if c.per_user:
        note = note or adopt_root_data(c)
        if not c.adopt_root_for and (c.data_dir / "profile.json").exists():
            print(f"NOTE: {c.data_dir / 'profile.json'} holds data from a single-user setup. With several users, each person gets their own "
                  f"folder under {c.data_dir / 'users'} and that file is no longer used. To keep it, copy profile.json, index.json and config.json "
                  f"into {c.data_dir / 'users' / '<login name>'}, or just set UNFURL_ADOPT_ROOT_DATA_FOR=<login name> and restart (see deploy/README.md).", file=sys.stderr)

    if port_in_use(c.host, c.port):
        sys.exit(f"Port {c.port} is already being used by another program on this computer, so Unfurl can't start here.\n"
                 "Is Unfurl already running (another window, the automatic start at sign-in, or Docker)? Run only one copy, "
                 f"or choose another port (UNFURL_PORT / --port {c.port + 1}).")
    Handler.cfg = c
    Handler.usage = UsageMeter(c.data_dir / "usage.json")
    try:
        httpd = Server((c.host, c.port), Handler)
    except OSError as e:
        hint = ""
        if c.port < 1024:
            hint = "\nPort 80 and other low ports are often used by another program (IIS, Skype, VPN or web-server software) or need extra permission. Use 8765 instead (UNFURL_PORT=8765 or --port 8765)."
        elif e.errno == errno.EADDRINUSE:
            hint = f"\nIs Unfurl already running? Try --port {c.port + 1}."
        sys.exit(f"Couldn't listen on {c.host}:{c.port}: {e}{hint}")

    shown = "localhost" if c.loopback_only else (sorted(c.allowed_hosts)[0] if c.allowed_hosts else c.host)
    url = f"http://{shown}:{c.port}/"
    print(f"Unfurl {APP_VERSION}{f' ({c.build})' if c.build else ''} is running at {url}")
    print(f"Your data is saved in {c.data_dir}{' (one folder per user)' if c.per_user else ''}")
    if not c.loopback_only:
        print(f"Listening on {c.host}; {'a login is required' if (c.users or c.trust_proxy_user) else 'NO LOGIN'}; "
              f"reachable as: {', '.join(sorted(c.allowed_hosts)) or '(set UNFURL_ALLOWED_HOSTS to the name people will type)'}")
    if c.yt_key:
        print(f"A shared YouTube key is configured (each user is capped at {c.user_daily_units} units a day).")
    if note:
        print(note)
    print("Press Ctrl+C to stop.")
    if c.open_browser and c.loopback_only:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    def stop(*_):
        threading.Thread(target=httpd.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
