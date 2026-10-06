# Changelog

## The data promise

Your library, history and ratings are never left behind by an update:

- They live **outside the app folder** (see the README for where), so replacing, re-downloading or `git pull`ing the app can't touch them.
- Every data file carries a **format version**. A newer app upgrades older data automatically, **after saving a backup of the old format**.
- An **older** app that meets data from a newer version refuses to write to it (it shows it read-only), so downgrading can't damage anything.
- When the **analysis** gets smarter, the app re-analyses everything you already have from the raw text and comments it stored; nothing is re-fetched and nothing is lost.
- A damaged file is set aside (never deleted) and the latest good backup is restored.

## 0.5.0

**A calmer look.** The Greek styling is gone. The app is now light blue and grey (with a matching dark mode that follows your system), set in Inter, a modern typeface that ships with the app, and has a new simple logo. The name is one constant (`js/brand.js`) and a few lines of `index.html`, so renaming it is a small job.

**A tidier exercise list.** The 126 exercises are grouped by the movement they train (pulling from above, rowing, pressing, squatting, hinging, core …) under Upper body / Lower body / Core. Groups open on tap; each exercise is one line (name, main muscles, what it takes, difficulty, ＋ Add); tapping it shows how it is done, helping muscles, the progression, your last and best, the guide videos, “Never suggest”, and Edit/Delete for your own. Searching opens the groups that match. The picker dialog uses the same compact rows with an ⓘ for the details.

**Exercises, workouts and plans, explained.** A short explainer on the Workouts page (an *exercise* is one movement, a *workout* is one session, a *plan* is an order of workouts to rotate through). A **Next up** block with a Start button, “in plan: …” / “single workout” badges on each workout, the rotation spelled out on each plan, and templates that say what they will save (“Save as a plan (3 workouts)”).

**An optional AI coach.** “Build it” uses simple scoring rules (and is now labelled as such: quick, offline, not an expert). New: **✨ Ask the coach** on the Workouts page, which asks Claude to design a workout, or a whole plan for a request like “4-day upper/lower split for running strength”, and **✨ Ask the coach** in the builder for ideas to round off a workout. Claude is shown only the exercises you can actually do (equipment, avoid list and “never suggest” already applied), and every exercise in its answer is checked against that list again before you see it; anything invented is dropped and mentioned. Drafts are labelled as Claude’s or as rule-based, and explain their choices.
- It needs your own Anthropic API key (Settings → AI coach), which the server keeps in a private file (`llm.json`) and never sends back to the browser, or one key on the server for everybody (`UNFURL_ANTHROPIC_KEY`). It costs a few US cents per request, billed by Anthropic. Per-person daily cap (`UNFURL_USER_DAILY_LLM_CALLS`, default 40).
- Sent to Anthropic, only when you press a coach button: your request, the catalogue of what you can do, your goal/level/session length/weak spots and your last two weeks of strength sessions. Never your library, notes, channels or YouTube key.
- Models: Claude Opus 5.5 (default) or Sonnet 5.5 (about half the price) in Settings, or `UNFURL_LLM_MODEL`.
- Without a key nothing changes; the coach explains what is missing and the rule-based builder keeps working.
- The server now serves a bundled font file (cached for a week); `llm.json` is included in `--backup` and `--restore`.

## 0.4.0

**Palaestra.** The app has a new name, logo and look, drawn from ancient Greece: the *palaestra* was where athletes trained. A pillar-shaped Π logo, a Greek-key (meander) border, terracotta, olive and gold in light mode and black-figure umber in dark mode, serif headings, and the Greek word for each page above it (Έκτασις for stretching, Δύναμις for strength, Υπομνήματα for the journal). The name lives in `js/brand.js`. Settings names (`UNFURL_…`), the data folder and Docker volumes are unchanged, so nothing has to be moved.

**Strength.** A new tab, kept apart from the stretching side. A catalogue of over 120 exercises (dumbbells, cable/weight station, pull-up bar, loop bands, inversion trainer, bodyweight) with muscles, difficulty, how-to cues and progression ladders, extendable with your own. Describe a workout in words, or start with a few exercises and let it suggest what is missing (every idea says why), fill to a time, swap, reorder, save and reuse. Templates (runner’s strength ×3, pistol path, full body, upper/lower, push/pull/legs, core and hips) fill in with your equipment and can be saved as a plan with “next up”. A set logger where reps, weight and time are optional and suggested from your last time (next weight you own, next rung of a progression), personal bests, an unfinished session that survives a reload, and “Stretch what you trained →”. YouTube guide videos can be attached to any exercise.

**One journal for both.** Separate weekly goals for stretching and strength; one calendar and 12-week chart in two colours with an All / Stretching / Strength filter; strength sessions listed with their sets in the day view and editable afterwards; sets per muscle, push against pull, personal bests and a per-exercise history; the muscle map shows stretching and strength side by side; the CSV has a type and an exercises column. Today’s reminder line shows both goals.

**Library: videos first.** Adding, importing a playlist or teacher, looking at a video first and “let the app go looking” now sit in one collapsed menu under the heading, so your videos come first. It opens by itself only while you have nothing yet.

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

**Training log.** The Journal now opens with a proper log of your practice: routines this week against a goal you set (default 3 a week, or none), your day streak and your streak of weeks at the goal, totals (routines, hours, days, average per week), a 12-week chart, a month calendar, achievements with the day you earned them (first routine, 10/50/100 routines, 3/7/30 days in a row, hours of practice, weeks of practice, muscle areas worked, "much better" answers) and what is closest, and per muscle whether it is helping more than at the start (needs 6 answers before it says). "＋ Log a routine I did" records one for an earlier day (the "did it help?" dialog also has a date now, and says plainly that saving adds the routine to the log). "Download as spreadsheet" saves the whole log as CSV. Today shows a quiet "This week: 2 of 3 · 4 days in a row" line. Everything is worked out from your history, so deleting an entry changes it honestly; the only new stored setting is the goal. Each routine now also remembers its length when logged, so changing a video later doesn't rewrite your minutes.

**Favourite channels.** "☆ Favourite channel" next to any video: that teacher's videos get up to 22 % more weight, but only as far as they also fit the request (muscles, length, style, typed words), so a favourite's poor match gains nothing. Shown as "★ Favourite" on cards, listed (and removable) in Settings. A channel can't be both favourite and blocked: each undoes the other. Favourites are saved with your profile and merged from backups.

**Backups to the cloud.** `python3 serve.py --backup FOLDER` writes one dated `.zip` per day of everyone's data (profile, index, key; `--small` leaves out the rebuildable index; `--keep N` prunes only old archives of that exact name), and `--restore FILE.zip` brings it back (refuses to overwrite existing data without `--force`, which moves it aside; only backup file names are accepted). On Windows with Docker, `backup-docker.bat` asks once for a folder (for example inside your Proton Drive folder) and saves there together with a copy of `unfurl.env`; `schedule-backup.bat` makes it daily. See `deploy/BACKUP.md` for what to include and how to restore.

**Your notes count.** What you write about a video (its note and tags in the Library, and what you wrote after doing it) is now read by the analysis as evidence for what the video works: "this releases my lower back" or a `hamstrings` tag makes it a candidate for that muscle, and the reasons say "in your own notes". A sentence saying it did not help or hurt is ignored, and removing a note removes its influence. The notes sit in your profile (not the rebuildable index), so a rebuild, a new machine or a restored backup brings them back into the analysis. On the video itself ("Today") you now see your tags, your note and what you wrote after doing it, and can add or edit them right there (saving a note on a video that isn't in your library adds it). One automatic re-analysis happens after this update.

**"✓ Did today".** One click on a video (Today, and every Library row) puts it in your training log, without questions and without needing it in your library; "How did it go?" in the toast, or "Edit" in the log, adds your answers to that same entry later. The training log now has a **day view**: it lists everything you did today, and clicking any day in the calendar lists that day, each entry with how it went, Edit and Remove (with Undo). "＋ Log something I did" records a routine from your library for any earlier day, or **something without a video** (a class, your own routine: a name, minutes, the muscles), which counts in the totals, streaks and the muscle map but never in the library or the suggestions. The history list is now ordered by day.

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
