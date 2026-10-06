# Unfurl on Windows: from "this PC" to "my whole home network"

Pick how far you want to go. Each step builds on the one before, so start at **1** and stop wherever it's enough.

| | What you get | Time |
|---|---|---|
| **1. This PC only** | Double-click, it opens in your browser. | 5 min |
| **2. Shared on your home network** | Your phone, laptop or another PC opens it too, behind a login. Starts by itself when you sign in. | +10 min |
| **3. Updates itself** (Docker Desktop) | Whatever gets pushed to GitHub is picked up within a minute, tested first, and rolled back if it breaks. | +30 min |

Nothing here is exposed to the internet. Don't set up port forwarding on your router.

> **Honest note:** the server itself is tested on Linux. The Windows batch files and Docker Desktop steps below are simple, but I could not run them on a real Windows machine, so if something doesn't behave as written, tell me the exact message and I'll fix it.

---

## 1. This PC only

1. **Install Python.** Go to <https://www.python.org/downloads/>, press the big yellow *Download Python* button, run the installer, and **tick "Add python.exe to PATH"** on the first screen before pressing *Install Now*.
2. **Get the app.** Pick one of these two ways:
   * **A. ZIP file (no extra software, simplest to start).** Download <https://github.com/silvanalig95-cmd/stretching-app/archive/refs/heads/claude/sharp-cray-hko5xu.zip>, right-click the file → *Extract All…* → extract into `C:\`. You get a folder called `stretching-app-claude-sharp-cray-hko5xu` (Windows sometimes nests it one level deeper; the right folder is the one that contains `start.bat`). Rename it to `Unfurl` if you like. Updates are manual: download the ZIP again and replace the folder (your data isn't in that folder, so it's safe).
   * **B. Git (needed for easy updates in steps 2 and 3).** In PowerShell run `winget install --id Git.Git -e` (or install **Git for Windows** from <https://git-scm.com/download/win> with all the defaults). **Then close PowerShell and open a new window**: an already-open window doesn't know about newly installed programs, and still says *"git is not recognized"*. Then:
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

1. In `C:\Unfurl` double-click **`start-network.bat`**. The first time it creates `network-settings.bat` and opens it in Notepad. Edit these two lines, then save and close:
   ```bat
   set "UNFURL_AUTH=me:pick-a-long-password-here"
   set "UNFURL_ALLOWED_HOSTS=%COMPUTERNAME%,192.168.1.50"
   ```
   * Replace `192.168.1.50` with this PC's address: open PowerShell, run `ipconfig`, and copy the **IPv4 Address** of your Wi-Fi or Ethernet adapter.
   * Use letters, digits and dashes in the password (avoid `& ^ % " < > |`). It is sent unencrypted over your home network, which is fine at home, but **don't reuse a password you use elsewhere**.
2. Double-click **`start-network.bat`** again. A window shows the addresses to use and stays open while the server runs (closing it stops the server).
3. **Windows Firewall:** the first time, Windows asks whether to let Python through. Tick **Private networks** and press *Allow access*.
   * Missed it, or other devices can't connect? Open PowerShell **as administrator** and run:
     ```powershell
     netsh advfirewall firewall add rule name="Unfurl" dir=in action=allow protocol=TCP localport=8765 profile=private
     ```
   * Also check your network is set to **Private**: *Settings → Network & internet → Wi-Fi (or Ethernet) → your network → Network profile type → Private*.
4. **Open it from another device** on the same network:
   * another Windows PC: <http://YOURPCNAME:8765> (the name printed in the window),
   * phone or anything else: <http://192.168.1.50:8765> (your IPv4 address).
   Log in with the name and password you chose.
   *Tip:* in your router's settings, give this PC a fixed ("reserved") address so the number never changes.
5. **Make it feel like an app** on a Windows client: in **Chrome**, ⋮ → *Cast, save and share* → *Create shortcut…* → tick *Open as window*. In **Edge**, ⋯ → *Apps* → *Install this site as an app* (if it isn't offered, use ⋯ → *More tools* → *Pin to taskbar*).
6. **Start automatically when you sign in:** double-click **`install-autostart.bat`** (no administrator needed). To undo, delete `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Unfurl.bat`.
7. **Keep the PC awake while others use it:** *Settings → System → Power → Screen and sleep* → set *When plugged in, put my device to sleep after* to **Never**. A sleeping PC can't serve anyone.

### Getting updates in this mode

* Set `set "UNFURL_AUTO_PULL=1"` in `network-settings.bat` (needs the Git clone from step 1.2). Each time the server **starts**, it first fetches the newest version from GitHub.
* To pick up something I just pushed: close the server window and double-click `start-network.bat` again (or sign out and in). Your data is unaffected.
* This mode has **no automatic testing or rollback**. If you'd rather have updates that arrive by themselves, safely, go to step 3.

---

## 3. Updates itself (Docker Desktop)

This runs the same tested auto-updating setup used for Linux servers, inside Docker. Every minute it checks GitHub; a new version is tested, switched to, health-checked, and **rolled back automatically** if it fails to start.

1. **Install Docker Desktop** from <https://www.docker.com/products/docker-desktop/>. Keep *Use WSL 2* ticked, restart when asked, open Docker Desktop once and accept the terms. In its *Settings → General*, tick **Start Docker Desktop when you sign in to Windows**.
2. Stop the step-2 server if it is running (close its window), and remove its autostart if you added it (see 2.6).
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
   UNFURL_ALLOWED_HOSTS=YOURPCNAME,192.168.1.50
   ```
   (The repository is public, so no token is needed.)
4. Start it:
   ```powershell
   docker compose -f deploy/docker-compose.yml up -d --build
   ```
   The first build takes a few minutes. Docker Desktop restarts it whenever Windows starts. If Windows Firewall asks about *Docker Desktop Backend*, allow **Private networks**.
5. Open <http://localhost:8765> (or the addresses from step 2.4) and log in.
6. **Check updates are flowing:**
   ```powershell
   docker compose -f deploy/docker-compose.yml logs --tail 20
   ```
   After I push a change you'll see a line like `update to 1a2b3c4d5e6f is live and healthy`. Pages you have open show **"A new version of Unfurl is ready — Reload"**.
7. **Bringing your data across from step 2:** in the old setup open *Settings → Export backup* (saves a file), then in the new one *Settings → Import backup*.
8. **Back up your data.** Use *Settings → Export backup* now and then (it saves a file on your PC). The server also keeps daily backups, but they live inside Docker's storage, so an exported file is your safety net.
9. Handy commands (from `C:\Unfurl`):
   | | |
   |---|---|
   | Stop | `docker compose -f deploy/docker-compose.yml down` (your data stays) |
   | Start again | `docker compose -f deploy/docker-compose.yml up -d` |
   | See what it's doing | `docker compose -f deploy/docker-compose.yml logs -f` |

If you later move to an always-on Linux machine, the same settings file and the same data work there: see [README.md](README.md).

---

## When something doesn't work

| What you see | Do this |
|---|---|
| `git` "is not recognized" | Git isn't installed yet, or this PowerShell window was opened before you installed it: install it (step 1.2 B), then **close and reopen PowerShell**. Or use the ZIP instead (step 1.2 A). |
| "Python was not found" | Re-run the Python installer → *Modify* / *Repair*, and make sure *Add python.exe to PATH* is ticked. |
| Window says *Refusing to listen without a login* | The password line in `network-settings.bat` is missing or empty. |
| Other devices can't connect at all | Firewall rule (2.3), network profile is *Private*, the PC isn't asleep, and you typed the right address. Test on the PC itself with <http://localhost:8765> first. |
| Page opens but says it can't reach the server / "forbidden" | The name or address you typed isn't in `UNFURL_ALLOWED_HOSTS`. Add it (exactly as you type it, without `http://` or the port) and restart. |
| "Address already in use" | Another copy is running. Close its window, or change `UNFURL_PORT`. |
| A video says *Error 153* or won't play | Tell me; it depends on the address you use to open the app. Opening it as `localhost` on the PC itself is the reference that always works. |
| Docker: container keeps restarting | `docker compose -f deploy/docker-compose.yml logs --tail 50` and send me the last lines. |
