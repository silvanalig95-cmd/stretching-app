# Changelog

## The data promise

Your library, history and ratings are never left behind by an update:

- They live **outside the app folder** (see the README for where), so replacing, re-downloading or `git pull`ing the app can't touch them.
- Every data file carries a **format version**. A newer app upgrades older data automatically, **after saving a backup of the old format**.
- An **older** app that meets data from a newer version refuses to write to it (it shows it read-only), so downgrading can't damage anything.
- When the **analysis** gets smarter, the app re-analyses everything you already have from the raw text and comments it stored; nothing is re-fetched and nothing is lost.
- A damaged file is set aside (never deleted) and the latest good backup is restored.

## 0.3.0

**Searches look much further.**
- A search is now a wide net run in rounds: several differently-worded queries, deeper result pages when results are mostly familiar, new wording learned from the best hits, until enough strong fits are found or the run's unit budget is spent. 50 results per page (was 10).
- **Thoroughness** setting (Quick / Balanced / Thorough / Exhaustive) with a stated cost; a run can never spend more than what is left of the day's allowance. A short report says what was searched, how many videos were weighed, and why it stopped.
- Comments are read for the best candidates (up to 60), so the muscle evidence behind the top picks is solid.

**Sharper keyword search.**
- Phrases, `-exclusions`, field filters (`teacher:` `pose:` `tag:` `for:` `title:` `len:`), field-weighted ranking (BM25F), typo tolerance, synonyms and word stems, "did you mean", suggestions while typing, and an "understood as" line. Saved searches.

**Look at a video first.** Paste one video link in the Library and get a readable analysis before deciding whether to keep it: muscles worked and why, exercises found, chapters, what viewers say, quality, and how it fits your body spots and library gaps. Nothing is stored until you add it; adding keeps the exact analysis that was shown.

**Combos.** When you pick several muscle areas and no single video covers them within your time, it assembles 2–3 short ones that do, and plays them in sequence.

**Hosting.** `serve.py` can now run as a shared, internal website: listen address and port, allowed host names, logins (one shared or several, hashed passwords, brute-force lock-out, or a trusted login proxy), a separate library per person, an optional server-held YouTube key with a per-person daily cap, security headers, `/healthz`, and a build id so open pages can offer a reload. It refuses to listen on a network without a login. New `deploy/` kit: **self-updating from a git branch** with self-test, health check and automatic rollback; systemd, Docker and installer. See `deploy/README.md`. Running it on your own computer works exactly as before.

**Speed with a big library.** Measured with a synthetic 2,000-video library (the most the app keeps): ranking ≈30 ms, a library search ≈2 ms, saving ≈35 ms. Rebuilding the search index after a small change went from ≈150 ms to ≈20 ms (each video's tokenised text is remembered and redone only when it changes), which also makes searches with typed words ≈3× faster. `npm run bench` prints the numbers; a unit test fails if they regress badly.

**Saves survive a server restart.** If the server is being updated at the moment a change is saved, the app now keeps the change, retries until it goes through, says so, and the "Reload" button waits until everything is stored.

**Addresses.** With a login on, home-network names and numbers (`192.168.1.50`, `mypc`, `mypc.local`, `.lan`, `.home.arpa`, `.internal`) are accepted without being listed, and `UNFURL_ALLOWED_HOSTS` takes wildcards (`*.fritz.box`). A page opened through a name the server refuses now says so in a red banner (and saves nothing) instead of silently falling back to browser storage. The Windows setup uses port 80 by default so addresses need no `:8765` (Docker publishes both 80 and 8765; the systemd unit may bind port 80). The "why this video" box is no longer empty when the match is only the fifth muscle you picked.

**Comments are always read on import.** Importing a playlist or a teacher now reads the viewer comments of every video (1 quota unit each, up to 300 per import, your library first), because that is where most of the muscle evidence comes from. A new **Read missing comments** button in the Library catches up on anything that has none; it stops cleanly when the day's allowance runs out and says how many are left.

**Updates you can verify.** The footer and Settings show the build (`Unfurl 0.3.0 · build 1a2b3c4`); the Docker updater now takes its own logic from the live release, so changes to the update machinery arrive by themselves too; `rebuild-docker.bat` refreshes the container recipe in one click on the rare occasions that changes. `deploy/WINDOWS.md` explains what is automatic, what needs a rebuild, and how to check.

**For friends.** `UNFURL_USERS=anna:…;ben:…` gives several people their own logins and libraries in one setting; `UNFURL_ADOPT_ROOT_DATA_FOR=me` keeps your existing library as yours when you add them. `deploy/EXTERNAL.md` covers reaching it from outside your home network safely (Tailscale, Cloudflare Tunnel, a small rented server) and why not to open router ports.

**Finer muscle groups.** Alongside the general areas there are now specific ones, shown when you tap "＋ Specific muscles" (and always when selected): core → upper abs, **lower abdomen**, **side abs (obliques)**, deep core, pelvic floor; hip flexors → psoas; glutes → piriformis; lower back → QL, SI joint; upper back → between the shoulder blades, mid-back; neck → upper traps; shoulders → rotator cuff; arms → biceps, triceps, elbows; calves → Achilles, shins; feet → ankles, arches; plus knees. A video that works a specific part counts for its general area, and one that only says "core" is a weak match for each specific part (never a strong one). Typing "lower abs" selects exactly that. Existing videos are re-analysed once to gain the new areas. Everything general still works as before.

**Transcripts.** Paste a video's transcript (in "Look at a video first", or later via a library video's "Tags & note") and the analysis uses what the teacher says: which muscles each move is for, which exercises come up, and when. YouTube's API doesn't hand other people's transcripts to other programs, so they are pasted, not fetched.

**"Not for me ▾"** now offers *just this video* or *everything from this channel*, and Settings → Hidden videos & channels lists everything you hid, each with "Allow again".

**Settings file mistakes are caught.** The settings template no longer has two `UNFURL_AUTH=` lines (the second, empty one cancelled a typed password); the server explains that the last assignment wins when it refuses to start without a login, and rejects names typed into `UNFURL_HOST` (the listen address). The supervisor no longer pretends to roll back when there is nothing to roll back to.

**One copy per port.** The server now refuses to start when something already answers on its port, and says what to do. (On Windows two programs can silently share a port, which made a leftover copy hide a broken one.)

**Windows.** `deploy/WINDOWS.md` walks from "this PC only" through "shared on my home network" (`start-network.bat`, `network-settings.example.bat`, `install-autostart.bat`) to "updates itself" with Docker Desktop. `.gitattributes` keeps batch files CRLF and Linux scripts LF so a Windows checkout can't break the Docker image. The installer now follows the branch you cloned (the repository has no `main` yet).

**Hardening after an independent review.** An empty login password is refused; a login proxy can be required to present a shared secret; hashed passwords no longer contain `$` (which docker compose mangled); verified logins are cached for a few minutes (a page load used to re-run a slow hash ~20 times) and unknown names cost the same as known ones; manual backups are capped and every backup is written atomically (a full disk could leave a truncated daily backup that blocked the real one); `/healthz` works for HEAD; IPv6 addresses work. Updater: a silently crashing self-test no longer passes; JavaScript syntax errors are caught before deploying; machine-wide `http_proxy` settings no longer break the health check; a failed update keeps the earlier rollback target; a version that ran fine but can't start because of its settings is no longer swapped for an older one; rebuilding a Docker image without a repository brings in the new copy; the app folder and repository config are private; access tokens are never printed. **Two tabs or devices on one account no longer overwrite each other**: saves are checked against the version last seen and, if it moved, merged.

**Data format is unchanged** (still version 2): nothing to migrate when you update from 0.2.

## 0.2.0

**Your library is now yours.**
- The library starts **empty**. The starter videos moved to a separate **Suggestions** shelf. What the app finds by searching lands in **Discovered**. You promote what you like with "＋ Library". Videos you finish, paste, or import on request are added automatically. A setting can add every find automatically.
- Tags and notes on library videos, both searchable.

**Storage that outlives versions.**
- Data moved from `./userdata` to your per-user data folder (copied over automatically on first launch; the originals are left in place).
- Split into `profile.json` (library, history, ratings, preferences; small and backed up) and `index.json` (everything discovered; rebuildable), plus a private `config.json` for the API key.
- Format versioning with a migration chain, read-only protection against newer data, daily + pre-upgrade backups, restore from Settings, corruption recovery, and a refusal to write when the data couldn't be read.
- Raw material (descriptions, a sample of comments) is now stored, and the analysis is versioned, so future improvements apply retroactively.

**Search and indexing.**
- A local BM25 search index over titles, teachers, chapter lists, poses, inferred muscles, what viewers wrote, and your tags and notes.
- The command box understands free text ("pigeon pose, 20 min", "Kassandra neck") alongside muscles and length.
- After a search, the top results that haven't had their comments read get them read automatically (1 unit each).
- Search results are fetched one page deeper automatically when a page is mostly videos you already know.

**New sources.**
- Paste a teacher (channel link, @handle or name), a playlist, or several video links. Whole catalogues cost about 1 quota unit per 50 videos.
- Follow teachers and check for new uploads.

**Your body.**
- Standing tight/weak spots, a "what have I been neglecting?" button, and a 4-week heat-map in the Journal.

## 0.1.0

First version: command box, muscle picker, live YouTube search with comment analysis, embedded player, "did it help?" learning.
