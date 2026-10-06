# Unfurl on Windows: from "this PC" to "my whole home network"

Pick how far you want to go. Each step builds on the one before, so start at **1** and stop wherever it's enough.

| | What you get | Time |
|---|---|---|
| **1. This PC only** | Double-click, it opens in your browser. | 5 min |
| **2. Shared on your home network** | Your phone, laptop or another PC opens it too, behind a login. Starts by itself when you sign in. | +10 min |
| **3. Updates itself** (Docker Desktop) | Whatever gets pushed to GitHub is picked up within a minute, tested first, and rolled back if it breaks. | +30 min |

Nothing here is exposed to the internet. Don't set up port forwarding on your router.

> **Honest note:** the server itself is tested on Linux. The Windows batch files and Docker Desktop steps below are simple, but I could not run them on a real Windows machine, so if something doesn't behave as written, tell me the exact message and I'll fix it.

Jump to: [what to keep](#what-to-keep-and-what-you-can-delete) · [start automatically](#start-automatically-when-the-pc-turns-on) · [no `:8765` in the address](#addresses-without-a-port-number) · [using the PC's name instead of its number](#using-the-pcs-name-instead-of-its-number) · [troubleshooting](#when-something-doesnt-work)

---

## 1. This PC only

1. **Install Python.** Go to <https://www.python.org/downloads/>, press the big yellow *Download Python* button, run the installer, and **tick "Add python.exe to PATH"** on the first screen before pressing *Install Now*.
2. **Get the app.** Pick one of these two ways:
   * **A. ZIP file (no extra software, simplest to start).** Download <https://github.com/silvanalig95-cmd/stretching-app/archive/refs/heads/claude/sharp-cray-hko5xu.zip>, right-click the file → *Extract All…* → extract into `C:\`. You get a folder called `stretching-app-claude-sharp-cray-hko5xu` (Windows sometimes nests it one level deeper; the right folder is the one that contains `start.bat`). Rename it to `Unfurl` if you like. Updates are manual: download the ZIP again and replace the folder (your data isn't in that folder, so it's safe).
   * **B. Git (needed for easy updates in step 2).** In PowerShell run `winget install --id Git.Git -e` (or install **Git for Windows** from <https://git-scm.com/download/win> with all the defaults). **Then close PowerShell and open a new window**: an already-open window doesn't know about newly installed programs, and still says *"git is not recognized"*. Then:
     ```powershell
     cd C:\
     git clone https://github.com/silvanalig95-cmd/stretching-app.git Unfurl
     ```
   Either way, keep the folder outside OneDrive-synced folders. The rest of this guide calls it `C:\Unfurl`.
3. **Start it.** Open `C:\Unfurl` and double-click **`start.bat`**. Your browser opens <http://localhost:8765>.
4. **Add your YouTube key:** *Settings* → paste → *Save*.

Your data (library, history, key) lives in `%APPDATA%\Unfurl` (paste that into the Explorer address bar), **outside** the app folder, so updating or re-downloading the app never touches it.

---

## 2. Shared on your home network

1. In `C:\Unfurl` double-click **`start-network.bat`**. The first time it creates `network-settings.bat` and opens it in Notepad. Change the password line, then save and close:
   ```bat
   set "UNFURL_AUTH=me:pick-a-long-password-here"
   ```
   * Use letters, digits and dashes (avoid `& ^ % " < > |`). The password travels unencrypted over your home network, which is fine at home, but **don't reuse a password you use elsewhere**.
   * The same file has `UNFURL_PORT=80`, which is why addresses don't need `:8765` (see [below](#addresses-without-a-port-number)). If the window later says port 80 is in use, change it to `8765`.
2. Double-click **`start-network.bat`** again. A window shows the addresses to use and stays open while the server runs (closing it stops the server).
3. **Windows Firewall:** the first time, Windows asks whether to let Python through. Tick **Private networks** and press *Allow access*.
   * Missed it, or other devices can't connect? Open PowerShell **as administrator** and run:
     ```powershell
     netsh advfirewall firewall add rule name="Unfurl" dir=in action=allow protocol=TCP localport=80,8765 profile=private
     ```
   * Also check your network is set to **Private**: *Settings → Network & internet → Wi-Fi (or Ethernet) → your network → Network profile type → Private*.
4. **Open it from another device** on the same network: `http://192.168.1.50/` (your PC's IPv4 address, from `ipconfig`) or `http://YOURPCNAME/`. Type the `http://` the first time. Log in with the name and password you chose.
5. **Make it feel like an app** on a Windows client: in **Chrome**, ⋮ → *Cast, save and share* → *Create shortcut…* → tick *Open as window*. In **Edge**, ⋯ → *Apps* → *Install this site as an app* (if it isn't offered, use ⋯ → *More tools* → *Pin to taskbar*).
6. **Start automatically when you sign in:** double-click **`install-autostart.bat`** (no administrator needed). To undo, delete `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Unfurl.bat`.
7. **Keep the PC awake while others use it:** *Settings → System → Power → Screen and sleep* → set *When plugged in, put my device to sleep after* to **Never**. A sleeping PC can't serve anyone.

### Getting updates in this mode

* Set `set "UNFURL_AUTO_PULL=1"` in `network-settings.bat` (needs the Git clone, step 1.2 B). Each time the server **starts**, it first fetches the newest version from GitHub.
* To pick up something I just pushed: close the server window and double-click `start-network.bat` again (or sign out and in). Your data is unaffected.
* This mode has **no automatic testing or rollback**. If you'd rather have updates that arrive by themselves, safely, go to step 3.

---

## 3. Updates itself (Docker Desktop)

This runs the same tested auto-updating setup used for Linux servers, inside Docker. Every minute it checks GitHub; a new version is tested, switched to, health-checked, and **rolled back automatically** if it fails to start.

1. **Install Docker Desktop** from <https://www.docker.com/products/docker-desktop/>. Keep *Use WSL 2* ticked, restart when asked, open Docker Desktop once and accept the terms. Before the next step, make sure Docker Desktop is **running** (its window says *Engine running*); `docker info` in PowerShell should print details without an error.
2. Stop the step-2 server if it is running (close its window), and remove its autostart if you added it (see 2.6). Two copies would fight over the same port.
3. Open PowerShell in the app folder and create your settings file:
   ```powershell
   cd C:\Unfurl
   copy deploy\unfurl.env.example deploy\unfurl.env
   notepad deploy\unfurl.env
   ```
   Fill in these lines (no spaces around `=`, nothing after the value on the same line):
   ```
   UNFURL_REPO_URL=https://github.com/silvanalig95-cmd/stretching-app.git
   UNFURL_BRANCH=claude/sharp-cray-hko5xu
   UNFURL_AUTH=me:pick-a-long-password-here
   ```
   (The repository is public, so no token is needed. You don't need to list your PC's name or number in `UNFURL_ALLOWED_HOSTS`: with a login on, home-network names and numbers are accepted automatically. List other names there if you use any.)
4. Start it:
   ```powershell
   docker compose -f deploy/docker-compose.yml up -d --build
   ```
   The first build takes a few minutes. If Windows Firewall asks about *Docker Desktop Backend*, allow **Private networks**.
5. Open <http://localhost/> (or <http://localhost:8765/>) and log in.
6. **Check that it is running correctly:**
   * In Docker Desktop → *Containers*, the **unfurl** entry has a green dot. Click its **›** arrow to see the container inside: it should say *Running* and show its ports.
   * In PowerShell: `docker compose -f deploy/docker-compose.yml ps` should say `Up ... (healthy)` (the *healthy* appears after about a minute).
   * Open <http://localhost/healthz>. It shows something like `{"ok": true, "app": "unfurl", "version": "0.3.0", "build": "1114e3c9a0b2"}`. The **build** is the start of the GitHub version it is running: compare it with the newest commit on <https://github.com/silvanalig95-cmd/stretching-app/commits/claude/sharp-cray-hko5xu> (the first 7 characters match). If it says `"build": "docker"`, it is still on the copy built into the image and has not reached GitHub yet; look at the logs below for a line mentioning "couldn't fetch".
   * Logs: `docker compose -f deploy/docker-compose.yml logs --tail 30`. You should see `a login is required`. After I push a change you will see a line like `update to 1a2b3c4d5e6f is live and healthy`, and pages you have open show **"A new version of Unfurl is ready — Reload"**.
7. **Bringing your data across from steps 1 or 2.** The Docker version keeps its own, separate data (inside Docker), so it **starts with an empty library**. If you had already built a library in the earlier setup and want it here:
   1. Run the old app next to Docker, on a different port. In PowerShell: `cd C:\Unfurl` then `python serve.py --port 8766`. Your browser opens <http://localhost:8766>, showing your old library (it reads `%APPDATA%\Unfurl`).
   2. There: **Settings → Your data → Export backup**. A file named `unfurl-backup-<date>.json` lands in your Downloads folder.
   3. Stop the old app (click the PowerShell window, press `Ctrl+C`).
   4. In the Docker version (<http://localhost/>): **Settings → Your data → Import backup** and pick that file.
   Backup files never contain your YouTube key, so paste it again under Settings. If you hadn't added anything worth keeping, skip all this.
8. **Back up your data.** Use *Settings → Your data → Export backup* now and then (it saves a file on your PC). The server also keeps daily backups, but they live inside Docker's storage, so an exported file is your safety net.
9. Handy commands (from `C:\Unfurl`):
   | | |
   |---|---|
   | Stop | `docker compose -f deploy/docker-compose.yml down` (your data stays) |
   | Start again | `docker compose -f deploy/docker-compose.yml up -d` |
   | See what it's doing | `docker compose -f deploy/docker-compose.yml logs -f` |

If you later move to an always-on Linux machine, the same settings file and the same data work there: see [README.md](README.md).

---

## What to keep, and what you can delete

How the pieces connect when you use Docker (step 3):

| Piece | What it is | Where it lives |
|---|---|---|
| **The app** | A ready-made copy, built once, then kept up to date by pulling new versions from GitHub *inside* Docker | Docker (the "image" and its `unfurl-app` storage) |
| **Your data** | Library, history, ratings, backups | Docker (the `unfurl-data` storage) |
| **The recipe and your settings** | `deploy\docker-compose.yml`, `deploy\Dockerfile`, and **`deploy\unfurl.env`** (your password, repository, branch) | `C:\Unfurl` |

* **The downloaded ZIP file can be deleted.** It was only a way to get `C:\Unfurl`.
* **Keep `C:\Unfurl`.** The running app doesn't read it, and updates don't come from it, so the app keeps working even if the folder vanishes. But you need it to **change a setting** (password, port, name), to **recreate** the container, to **rebuild** after I change the container recipe itself (rare; the app's own updates don't need this), and after reinstalling Docker. It's about 1 MB. The files `start.bat`, `start-network.bat` etc. in it are the non-Docker alternative; leave them alone, just don't run them while Docker is running.
* If you insist on tidying up: keep the `deploy` folder (especially `deploy\unfurl.env`) and delete the rest. Don't delete anything inside Docker Desktop's *Volumes* tab: that is your data.

---

## Start automatically when the PC turns on

With Docker (step 3) this is mostly already in place: the container is set to restart by itself. Check these once:

1. **Docker Desktop must start by itself.** Open Docker Desktop → ⚙ *Settings* → *General* → tick **Start Docker Desktop when you sign in to Windows**. (Untick *Open Docker Dashboard when Docker Desktop starts* if you don't want its window popping up.)
2. **Never press Stop on the container** (or run `docker compose ... down`). A container you stopped yourself stays stopped after a restart. If that happens, run `docker compose -f deploy/docker-compose.yml up -d` once.
3. **It starts when you sign in to Windows**, not at the moment the PC powers on, because Docker Desktop runs inside your user session. If the PC should serve even after an unattended restart (power cut), let Windows sign in by itself: press `Win+R`, type `netplwiz`, untick *Users must enter a user name and password to use this computer*. The catch: anyone who can switch the PC on gets in. If that tick box isn't shown, turn off *Settings → Accounts → Sign-in options → "For improved security, only allow Windows Hello sign-in…"* first.
4. **Don't let it sleep:** *Settings → System → Power → Screen and sleep* → *Never* (when plugged in).
5. **Make the firewall rule permanent** (once, PowerShell **as administrator**):
   ```powershell
   netsh advfirewall firewall add rule name="Unfurl" dir=in action=allow protocol=TCP localport=80,8765 profile=private
   ```
6. **Test it:** restart the PC, sign in, wait about two minutes, then open <http://localhost/healthz> on the PC and `http://192.168.1.50/` (your address) on another device.

Without Docker (step 2), `install-autostart.bat` does the equivalent: it starts the server at sign-in.

---

## Addresses without a port number

Web addresses assume port **80**, so if Unfurl listens there you never type `:8765`:

* **Docker:** the compose file now publishes both: `80` (so `http://192.168.1.50/` works) and `8765` (old bookmarks keep working). **If you set up Docker before this change**, open `C:\Unfurl\deploy\docker-compose.yml` in Notepad and make the `ports:` section read:
  ```yaml
      ports:
        - "80:8765"
        - "8765:8765"
  ```
  (Mind the indentation: spaces, as in the other lines.) Save, then in PowerShell:
  ```powershell
  cd C:\Unfurl
  docker compose -f deploy/docker-compose.yml up -d
  docker compose -f deploy/docker-compose.yml ps
  ```
  The `ps` output should show `0.0.0.0:80->8765/tcp`. Your data stays (it's in separate storage). *If you get "port is already allocated" or "Only one usage of each socket address"*: another program on the PC already uses port 80 (often IIS, Skype, a VPN, or other web-server software). Delete the `- "80:8765"` line and keep using `:8765`.
* **Without Docker:** `network-settings.bat` has `UNFURL_PORT=80`.
* In a browser, type the full `http://192.168.1.50/` the first time (a bare number may be treated as a search), then bookmark it.

---

## Using the PC's name instead of its number

Try `http://THEPCNAME/` (run `hostname` in PowerShell to see the name). Two separate things can get in the way:

1. **The other device doesn't know the PC's name.** The browser says something like *"This site can't be reached"*, *ERR_NAME_NOT_RESOLVED* or *DNS_PROBE_FINISHED_NXDOMAIN*. That's the network, not Unfurl.
   * **Windows PCs** find each other by name when both are on a **Private** network with *network discovery* on (*Settings → Network & internet → Advanced network settings → Advanced sharing settings → Private networks → Network discovery*).
   * **iPhones and Macs** usually need `http://THEPCNAME.local/`.
   * **Android phones** often can't look up Windows PC names at all.
   * The reliable fix for every device: log in to your **router** and (a) give this PC a **fixed ("reserved") address** so the number never changes, and (b) if the router offers local names (a FRITZ!Box does: `THEPCNAME.fritz.box`), use those. Otherwise just bookmark the number.
2. **The server refuses the name.** The page loads but shows a red banner: *"You opened Unfurl as … which the server doesn't accept…"*. With a login set up, the server accepts, without any listing, these kinds of names: numbers (`192.168.1.50`), bare computer names (`mypc`), and names ending in `.local`, `.lan`, `.home.arpa` or `.internal`. Anything else, like `mypc.fritz.box`, goes into `UNFURL_ALLOWED_HOSTS` (for Docker in `deploy\unfurl.env`, then `docker compose -f deploy/docker-compose.yml up -d`; wildcards are fine: `*.fritz.box`). Older versions of the app only accepted names you listed; Docker picks up the newer rule on its own within a minute of me pushing it.

---

## When something doesn't work

| What you see | Do this |
|---|---|
| `git` "is not recognized" | Git isn't installed yet, or this PowerShell window was opened before you installed it: install it (step 1.2 B), then **close and reopen PowerShell**. Or use the ZIP instead (step 1.2 A). |
| "Python was not found" | Re-run the Python installer → *Modify* / *Repair*, and make sure *Add python.exe to PATH* is ticked. |
| Window says *Refusing to listen without a login* | The password line in `network-settings.bat` is missing or empty. |
| Window says port 80 can't be used | Another program uses it. Set `UNFURL_PORT=8765` in `network-settings.bat` and use `:8765` in addresses. |
| Other devices can't connect at all | Firewall rule (2.3), network profile is *Private*, the PC isn't asleep, and you typed the right address. Test on the PC itself with <http://localhost/> or <http://localhost:8765/> first. |
| Page opens but says it can't reach the server, or a red banner about the address | See [using the PC's name](#using-the-pcs-name-instead-of-its-number): the name you typed isn't accepted. |
| "Address already in use" | Another copy is running (a step-2 window, or Docker). Close it, or change the port. |
| A video says *Error 153* or won't play | Tell me; it depends on the address you use to open the app. Opening it as `localhost` on the PC itself is the reference that always works. |
| Docker: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... cannot find the file specified` | Docker Desktop is installed but **not running**. Start it from the Start menu and wait until its window says *Engine running* (the whale icon in the tray stops animating). First time: accept the terms, skip the sign-in. If it complains about WSL or virtualization: open PowerShell **as administrator**, run `wsl --install`, restart the PC, and make sure virtualization is enabled in the BIOS/UEFI (Task Manager → Performance → CPU shows "Virtualization: Enabled"). Check with `docker info`, then re-run the `docker compose ... up -d --build` command. |
| Docker: container keeps restarting | `docker compose -f deploy/docker-compose.yml logs --tail 50` and send me the last lines. |
| After a restart the app isn't there | Docker Desktop isn't running yet (wait two minutes after signing in), or the container was stopped by hand: `docker compose -f deploy/docker-compose.yml up -d`. |
