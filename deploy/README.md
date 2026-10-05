# Hosting Unfurl on a server (with automatic updates)

The idea: the server **follows a git branch**. Whenever a new version is pushed to that branch, the server notices within a minute, tests it, switches to it, and checks it came up healthy. If anything is wrong it keeps (or goes back to) the version that was working. People with the page open see *“A new version of Unfurl is ready — Reload”*.

```
  you ask for a change in chat ─► Claude commits + pushes to the branch
                                          │   (git: GitHub)
        every 60 s, on your server ◄──────┘
   1. git fetch            – anything new?                     no  → do nothing
   2. unpack beside the live version, run `serve.py --selftest` fail → keep the live version, remember the bad one
   3. switch (one atomic symlink change) and restart
   4. wait for /healthz to report the NEW build                fail → switch back, restart, remember the bad one
   5. open browser tabs see the new build → "Reload" banner
```

Your server only makes **outgoing** connections (to GitHub). Nothing from the internet needs to reach it, which suits an internal server. Your **data** (library, history, API key) lives in its own folder that updates never touch.

## What you need

- A Linux machine you control (a small VM or Raspberry Pi is plenty) with `python3` and `git`. **systemd** for the simple setup, or **Docker** if you prefer containers.
- Outgoing access to `github.com` (HTTPS or SSH).
- The repository: `silvanalig95-cmd/stretching-app` (or wherever you keep it).
- **Decide the branch the server follows** (`UNFURL_BRANCH`). Whoever can push to that branch can change the code that runs on your server, so make it a branch only you (and Claude, on your request) push to, and turn on GitHub *branch protection* for it if you like.

## Option A: Linux with systemd (recommended)

```bash
git clone https://github.com/silvanalig95-cmd/stretching-app.git
cd stretching-app
sudo deploy/install.sh --branch main --host unfurl.internal
```

That creates a `unfurl` service account, downloads the first version into `/opt/unfurl`, writes the settings file `/etc/unfurl/unfurl.env` (with a **generated login**, printed once), and starts the service so it also starts on boot. Data goes to `/var/lib/unfurl`.

Then edit `/etc/unfurl/unfurl.env` for the rest (see the comments in it) and `sudo systemctl restart unfurl`.

Day to day:

| | |
|---|---|
| Is it running? | `systemctl status unfurl` · `journalctl -u unfurl -f` |
| What did the updater do? | `less /opt/unfurl/update.log` |
| Which version is live? | `sudo -u unfurl UNFURL_HOME=/opt/unfurl /opt/unfurl/current/deploy/update.sh --status` |
| Is an update waiting? | same, with `--check` (exit code 10 = yes) |
| Update right now | same, no arguments |
| Go back one version | same, with `--rollback` (that version is then skipped until a newer commit arrives; `--force` retries it) |
| Stop automatic updates | `UNFURL_UPDATE_INTERVAL=0` in the settings file, restart |

## Option B: Docker

```bash
cp deploy/unfurl.env.example deploy/unfurl.env      # fill in login, allowed host, repository
docker compose -f deploy/docker-compose.yml up -d --build
```

The image contains a copy of the app and, if `UNFURL_REPO_URL` is set, updates itself from git exactly as above, with no rebuilds. Without a repository it just runs what is baked in (rebuild to update). Two volumes: `unfurl-data` is **your data**, back it up; `unfurl-app` holds downloaded versions and can be deleted. `docker compose logs -f` shows what the updater did.

## Who can use it (logins)

The server **refuses to listen on the network without a login**, so it can never be left open by accident. Choose one:

- **One shared login** (a household): `UNFURL_AUTH=name:passphrase`. Everyone shares one library.
- **A login per person**, each with their own library, history and ratings: put one `name:password` per line in a file and set `UNFURL_USERS_FILE=/etc/unfurl/users.txt`. Each person's data goes to its own folder under `users/`, and nobody can see another's.
- **You already have SSO / a login proxy** (Authelia, oauth2-proxy, Cloudflare Access, Tailscale serve...): set `UNFURL_TRUST_PROXY_USER=X-Forwarded-User` (the header your proxy sets). The server then believes that header **only from the proxy's address** (`UNFURL_PROXY_IPS`, default `127.0.0.1`), so keep the server reachable only through the proxy.

Passwords can be stored hashed: run `python3 serve.py --hash-password` and paste the result after the name. Five wrong passwords lock that visitor out for a minute.

`UNFURL_ALLOWED_HOSTS` must list the name(s) people type (`unfurl.internal`, `10.0.0.5`). The server's API refuses requests that arrive under any other name (and requests that come from other websites); this stops a malicious page from using your browser to talk to the server.

## HTTPS

Logins and your data travel in the clear over plain `http://`. Inside a trusted network that may be acceptable; otherwise put a reverse proxy with HTTPS in front, bind Unfurl to `127.0.0.1` (`UNFURL_HOST=127.0.0.1`), and list the public name in `UNFURL_ALLOWED_HOSTS`.

**Caddy** (gets certificates automatically; `tls internal` makes its own for an internal name, which you install once on your devices):

```
unfurl.internal {
    tls internal
    reverse_proxy 127.0.0.1:8765
}
```

**nginx**:

```nginx
server {
    listen 443 ssl;
    server_name unfurl.internal;
    ssl_certificate     /etc/ssl/unfurl.crt;
    ssl_certificate_key /etc/ssl/unfurl.key;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;                               # required: it is checked
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## YouTube access for everyone

Searching YouTube needs a free API key. Either each person pastes their own in **Settings** (their own 10,000 units a day), or you keep **one key on the server** (`UNFURL_YOUTUBE_KEY` or `UNFURL_YOUTUBE_KEY_FILE`) and nobody needs one: the browser never sees it, and each person is capped (`UNFURL_USER_DAILY_UNITS`, default 3,000 of the key's 10,000 a day, counted in Pacific time like YouTube's own day and remembered across restarts). A person who pastes their own key uses that instead.

## Private repository

The server needs read access to the repository. Pick one:

- **Deploy key (SSH)**: as the service user, `sudo -u unfurl ssh-keygen -t ed25519 -f /home/unfurl/.ssh/id_ed25519 -N ''`, add the `.pub` file to the repository under *Settings → Deploy keys* (read-only), run `sudo -u unfurl sh -c 'ssh-keyscan github.com >> /home/unfurl/.ssh/known_hosts'`, and set `UNFURL_REPO_URL=git@github.com:silvanalig95-cmd/stretching-app.git`.
- **Token (HTTPS)**: create a fine-grained personal access token with *read-only* access to this one repository and set `UNFURL_REPO_URL=https://x-access-token:TOKEN@github.com/silvanalig95-cmd/stretching-app.git`. The settings file is readable only by root and the service user.

## How it protects you

- A new version must pass `serve.py --selftest` (serves every page and script, hides internal files, saves and reads data) **before** anything live changes; shell scripts must also parse.
- After switching, the server has `UNFURL_HEALTH_TIMEOUT` seconds (30) to report the new build on `/healthz`; otherwise the previous version is restored automatically and the bad commit is skipped until a newer one arrives.
- If the live version keeps crashing right after starting, the supervisor falls back to the previous version by itself.
- Only one updater runs at a time; the last 5 versions are kept; updates and rollbacks never touch the data folder; the data format only ever moves forward *after* a backup (see `CHANGELOG.md`).
- An unreachable GitHub is logged once and retried quietly.

Run the safety net's own tests with `node --test tests/unit/deploy.test.js` (they use a local git repository as a stand-in for GitHub and start real servers).

## Backups

Back up the **data folder** (`/var/lib/unfurl`, or the `unfurl-data` volume). The app also keeps a daily backup of each profile inside it (`backups/`), restorable from **Settings → Your data**, but a copy on another disk protects you from losing the machine. Example nightly copy: `rsync -a /var/lib/unfurl/ backup-host:/backups/unfurl/`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Refusing to listen on 0.0.0.0 without a login` | Set `UNFURL_AUTH` (or a users file / trusted proxy), or use `UNFURL_HOST=127.0.0.1`. |
| Page loads but the app says it can't reach the server / 403 | The name in the address bar isn't in `UNFURL_ALLOWED_HOSTS`, or your proxy doesn't pass the `Host` header. |
| Updates never arrive | `update.sh --status` and `update.log`. Usually: no `UNFURL_REPO_URL`, a wrong branch, or GitHub unreachable / not authorised. |
| `NOT updating to … failed its self-test` | The pushed version is broken; the live one keeps running. Push a fix. |
| Locked out after typos | Wait a minute. |
| Everyone shares one YouTube allowance | Set per-person logins (`UNFURL_USERS_FILE`) so the shared key is capped per person. |
