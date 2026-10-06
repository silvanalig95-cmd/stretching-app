# Backing up Unfurl, and getting it back if the server dies

## The short answer: what to include

Only **two things** are worth keeping. Everything else is downloaded or rebuilt for you.

| What | Where it is | What it holds |
|---|---|---|
| **The data folder** | Docker: the `unfurl-data` volume (not a normal folder, see below). Windows without Docker: `%APPDATA%\Unfurl`. Linux server: `/var/lib/unfurl` (or `~/.local/share/unfurl`). | For every person: `profile.json` (library, history, ratings, favourites, blocks, weekly goal: **the precious one**), `config.json` (their YouTube key), `index.json` (what the app discovered and analysed: rebuildable, but re-fetching costs YouTube quota). With several logins each person has their own folder under `users/`. |
| **Your settings file** | `deploy\unfurl.env` in the app folder | The logins, host names, the shared YouTube key, the update branch. Without it you would have to recreate those. |

Not needed: the app folder itself (re-download it), the `unfurl-app` volume (it re-downloads), Docker's images.

Unfurl already keeps daily backups **inside** the data folder (Settings → Your data). Those protect you from mistakes, not from losing the machine, which is what the rest of this page is for.

## Why you can't simply point Proton Drive at the data

With Docker Desktop the data volume lives inside Docker's own hidden virtual disk, so Windows (and Proton Drive) can't see it as a folder. And even where a data folder *is* visible, syncing files while the server is writing them can upload half-finished states or create "conflicted copy" files. So Unfurl makes a **snapshot** instead: one `.zip` per day, written in one go into an ordinary folder, which Proton Drive then uploads like any other file.

## Set it up once (Windows + Docker)

1. **Proton Drive.** Install the Proton Drive app for Windows and sign in. It gives you a folder that is kept in sync (look for "Proton Drive" in Explorer's left-hand list, or in the app's settings). Inside it, create a folder called `Unfurl backup`.
2. **Get the backup scripts.** They are new files in the app folder: double-click `rebuild-docker.bat` (it downloads the newest files and rebuilds the container; your data and `unfurl.env` are not touched). Afterwards the folder contains `backup-docker.bat` and `schedule-backup.bat`.
3. **Make the first backup.** Double-click `backup-docker.bat`. It asks for the folder: paste the full path of `Unfurl backup` (in Explorer, open the folder and click the address bar to copy it, for example `C:\Users\you\Proton Drive\Unfurl backup`). It remembers the answer. You should see `Saved …\unfurl-backup-2026-….zip`.
4. **Check that it arrived.** The Proton Drive icon in the tray shows the upload; open <https://drive.proton.me> and look for the zip and `unfurl.env` in that folder.
5. **Make it automatic.** Double-click `schedule-backup.bat`. A backup now runs every day at 12:30 (if the PC was off, as soon as you sign in again). To change the time, open the file in Notepad and edit `set "AT=12:30"`. The result of the last run is written to `deploy\backup-last.txt`. To stop it: `schtasks /Delete /TN "Unfurl backup" /F`.

What you end up with, in that one folder: `unfurl-backup-YYYY-MM-DD.zip` (one per day; the newest 14 are kept, older ones removed; nothing else in the folder is ever touched) and a copy of `unfurl.env`. A backup is a few megabytes. Docker Desktop and the PC must be on at the scheduled time, and Docker Desktop should start with Windows (see WINDOWS.md).

Options, if you want them: in `backup-docker.bat`, at the end of the line that runs `serve.py --backup /backup`, add `--keep 30` (keep a month) and/or `--small` (leave out the rebuildable `index.json`: much smaller, but the app has to re-learn the videos from YouTube after a restore).

### Privacy

The zip contains **everyone's** libraries and YouTube keys, and `unfurl.env` contains the logins. Proton Drive is end-to-end encrypted, so that is fine there. If you ever use a cloud that is not, don't copy it there as it is: encrypt the folder, or delete the `copy … unfurl.env` lines from `backup-docker.bat`. If you share Unfurl with friends, tell them their data is part of your backup.

## Getting it back (the server broke, or you have a new PC)

1. Install Docker Desktop and the app as in WINDOWS.md (steps 1 and 2), and put `unfurl.env` from your backup folder back into the app's `deploy` folder.
2. Start it once so Docker creates its volumes, then stop it again (in PowerShell, in the app folder):
   ```powershell
   docker compose -f deploy/docker-compose.yml up -d --build
   docker compose -f deploy/docker-compose.yml stop
   ```
3. Restore. Use the real path of your backup folder and the date of the zip you want:
   ```powershell
   docker compose -f deploy/docker-compose.yml run --rm -T -v "C:\Users\you\Proton Drive\Unfurl backup:/backup" --entrypoint python3 unfurl /srv/unfurl/current/serve.py --restore /backup/unfurl-backup-2026-10-06.zip
   ```
   It says `Restored … files for … people`. If you had already opened the app on the new machine, it refuses and asks you to add `--force`, which moves the new, empty files aside rather than deleting anything.
4. Start it again: `docker compose -f deploy/docker-compose.yml up -d`. Open the app and log in: everything is back, for everybody.

**Try the restore once while nothing is wrong**, so you know it works. This unpacks into a throwaway place inside a temporary container and changes nothing:
```powershell
docker compose -f deploy/docker-compose.yml run --rm -T -v "C:\Users\you\Proton Drive\Unfurl backup:/backup" --entrypoint python3 unfurl /srv/unfurl/current/serve.py --restore /backup/unfurl-backup-2026-10-06.zip --data-dir /tmp/restore-test
```

**Just one person's data**, without touching the server: in the app, *Settings → Your data → Export backup* saves a single `.json` file, and *Import backup* on any Unfurl reads it back. Each friend can do this for their own library, and you can drop the file into Proton Drive too.

## Without Docker

- **Windows, the `.bat` install** (data in `%APPDATA%\Unfurl`): `python serve.py --backup "C:\Users\you\Proton Drive\Unfurl backup"`. Schedule that line with Task Scheduler.
- **A Linux server**, as a nightly job: `15 3 * * * python3 /srv/unfurl/current/serve.py --data-dir /var/lib/unfurl --backup /mnt/backup/unfurl`, or copy the folder with `rsync`. Restore with `--restore FILE.zip` while the server is stopped.
- On Linux with Docker, run the same `docker compose … run … --backup /backup` command from cron, with a backup folder your user can write to.

## Good to know

- A backup is a snapshot taken between saves; the app writes its files atomically, so a backup never catches a half-written file.
- `--restore` only accepts the file names a backup contains and never writes outside the data folder, so an archive from somewhere else can't overwrite anything else on the machine.
- Don't edit files inside the zip. If you only need to look: it opens in Explorer, and `profile.json` is plain text.
