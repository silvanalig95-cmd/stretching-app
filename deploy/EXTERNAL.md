# Letting friends use your Palaestra from outside your home network

Short version: **don't open a port on your router to your PC.** Use a private tunnel instead, give each friend their own login (and so their own library), and only ever let them reach it over **HTTPS**.

Your PC has to be on and Docker running whenever they want to use it (see [WINDOWS.md](WINDOWS.md) for starting automatically).

## 1. Give each friend their own login

Each login gets its own library, history, ratings and settings, completely separate from yours and each other's.

1. Make a password hash for each friend (PowerShell, in `C:\Unfurl`; it asks you to type the password twice and prints the hash):
   ```powershell
   docker compose -f deploy/docker-compose.yml run --rm --entrypoint python3 unfurl /opt/unfurl-seed/serve.py --hash-password
   ```
   It prints something like `pbkdf2-sha256:200000:AbC…:dEf…`. Use a **long, unique** passphrase (a few words), and tell your friend their password privately. Hashes mean the settings file never contains the passwords themselves.
2. Open `deploy\unfurl.env` and add (keep your existing `UNFURL_AUTH=me:…` line: it stays your login):
   ```
   UNFURL_USERS=anna:pbkdf2-sha256:200000:…;ben:pbkdf2-sha256:200000:…
   UNFURL_ADOPT_ROOT_DATA_FOR=me
   ```
   People are separated by `;`. `UNFURL_ADOPT_ROOT_DATA_FOR=me` is needed **once**, so the library you already built stays yours (it is copied into your own folder; nothing is deleted, and it never overwrites anything later).
3. Apply: `docker compose -f deploy/docker-compose.yml up -d --force-recreate`.
4. Check: log in as yourself (your library is still there), then in a private/incognito window as a friend (empty library).

**Their YouTube searches.** Either each friend pastes their own free YouTube key in Settings (their own 10,000 units a day), or you put your key on the server (`UNFURL_YOUTUBE_KEY=…`, see below) and they need nothing. With a shared key every person is capped (`UNFURL_USER_DAILY_UNITS`, default 3000 a day, about 10–30 web searches) so no one friend can use up everyone's allowance; with 10,000 units a day in total, 3 friends at 3000 each is about the limit. Reading comments and importing playlists costs units too.

**The AI coach.** Strength's “Ask the coach” uses Anthropic's Claude and costs a few cents per request. Friends can paste their own Anthropic key in Settings (their own bill), or you can put one on the server (`UNFURL_ANTHROPIC_KEY`) and let them use yours within a per-person daily cap (`UNFURL_USER_DAILY_LLM_CALLS`, default 40). Leave both unset and the button simply explains that it is not set up.

## 2. Pick how they reach it

### Option A (recommended): Tailscale — a private network, nothing opened to the internet

Only people you invite can even see your PC. Friends install the free Tailscale app (Windows, Mac, iPhone, Android) and open an `https://…ts.net` address.

1. Make a free account at <https://tailscale.com> and install Tailscale on **your PC** (the one running Docker); sign in.
2. In the Tailscale admin console (<https://login.tailscale.com/admin>), turn on **MagicDNS** and **HTTPS certificates** (DNS page).
3. Make the app reachable with HTTPS inside the tailnet. In PowerShell:
   ```powershell
   tailscale serve --bg 8765
   tailscale serve status
   ```
   `status` prints your address, like `https://olympus.tail1234.ts.net`. (Tailscale's commands change now and then; if that one is refused, follow their "Tailscale Serve" page.)
4. Tell Palaestra that name is fine: in `deploy\unfurl.env` set `UNFURL_ALLOWED_HOSTS=*.ts.net`, then `docker compose -f deploy/docker-compose.yml up -d --force-recreate`.
5. **Invite each friend**: in the admin console open your PC under *Machines* → ⋯ → **Share**, and send the link. They create their own free Tailscale account, install the app, accept, and then open your `https://…ts.net` address and log in to Palaestra with the login you made them. (Check Tailscale's current free-plan limits for how many people and devices that allows.)

*Tailscale Funnel* (`tailscale funnel`) can make that address reachable by anyone on the internet without installing anything, but then your Palaestra login page is public; only do that with strong passwords.

### Option B: Cloudflare Tunnel — a normal `https://unfurl.yourdomain.com` link, still no open ports

Friends need to install nothing. You need a domain name (about 10 € a year) managed by Cloudflare's free plan.

1. Add your domain to Cloudflare (free plan), then *Zero Trust → Networks → Tunnels → Create a tunnel*, and install the **cloudflared** connector it shows for Windows (it runs as a service).
2. Add a *public hostname*: `unfurl.yourdomain.com` → service `http://localhost:80` (or `http://localhost:8765`).
3. In `deploy\unfurl.env` set `UNFURL_ALLOWED_HOSTS=unfurl.yourdomain.com`, then recreate the container.
4. Optional but good: put *Cloudflare Access* in front (e.g. only your friends' email addresses, one-time PIN) so strangers never even see the Palaestra login page.

### Option C: a small rented server (about 4–6 € a month)

Always on, no dependence on your PC, no home network involved. Rent a small Linux VPS, then follow [README.md](README.md) (Docker or `install.sh`) and put HTTPS in front with Caddy (the example is there). You can move your data by exporting a backup (*Settings → Your data*) and importing it.

### Not recommended: opening ports on your router

It means your home PC answers to the whole internet. If you ever do it, you need a dynamic-DNS name, HTTPS (Caddy), and strong per-person passwords, and you accept that anything wrong with Palaestra or Docker is reachable from everywhere. Plain `http://` over the internet is never acceptable: passwords would travel in the clear.

## 3. Keeping it safe and fair

- **HTTPS only** when it leaves your home. Both options above give you that.
- **One login per person**, long and unique, hashed in the settings file. Five wrong tries lock a visitor out for a minute.
- **Updates keep arriving by themselves** (see WINDOWS.md); the server also refuses to start without a login.
- **Their data lives on your PC.** Tell friends that you can technically see their library and ratings, and back up the Docker data (*Settings → Your data → Export backup* works per person; each friend can export their own).
- **A YouTube key shared with friends** is fine for a small private group; if you ever open it to the public, YouTube's API Terms of Service (privacy policy, etc.) start to apply to you.
- To switch everything off: `docker compose -f deploy/docker-compose.yml down` (data stays), and `tailscale serve reset` / remove the tunnel.

## 4. If it doesn't work

| What you see | Do this |
|---|---|
| The link doesn't open at all | Your PC is off/asleep, Docker isn't running, or (Tailscale) the friend hasn't accepted the share / isn't connected in the Tailscale app. |
| A red banner "You opened Palaestra as … which the server doesn't accept" | That name isn't in `UNFURL_ALLOWED_HOSTS`: `*.ts.net` for Tailscale, the exact name for Cloudflare. Recreate the container after editing. |
| A friend sees *your* library | They logged in as you. Each friend needs their own login in `UNFURL_USERS`. |
| Your library is empty after adding `UNFURL_USERS` | Add `UNFURL_ADOPT_ROOT_DATA_FOR=me` (your login name) and recreate; your old data is still in the data folder. |
| "Refusing to start: UNFURL_USERS has an entry that doesn't look like name:password" | An entry has no password, or two people aren't separated by `;`. |
| Searches stop with "Your share of today's YouTube allowance … is used up" | That person hit their daily cap (`UNFURL_USER_DAILY_UNITS`); it resets at midnight Pacific time. |
