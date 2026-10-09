# Changelog

## The data promise

Your library, history and ratings are never left behind by an update:

- They live **outside the app folder** (see the README for where), so replacing, re-downloading or `git pull`ing the app can't touch them.
- Every data file carries a **format version**. A newer app upgrades older data automatically, **after saving a backup of the old format**.
- An **older** app that meets data from a newer version refuses to write to it (it shows it read-only), so downgrading can't damage anything.
- When the **analysis** gets smarter, the app re-analyses everything you already have from the raw text and comments it stored; nothing is re-fetched and nothing is lost.
- A damaged file is set aside (never deleted) and the latest good backup is restored.

## 0.10.0

**Teachers.** A new page with a starting list of 188 YouTube teachers for yoga, stretching, mobility, rehab and Pilates: what each one teaches, who it suits, and where a source said so, whether a woman or a man teaches. Filter it by words, style, what it is good for, level and who teaches; open them on YouTube; add their videos (with a YouTube key); mark favourites; correct who teaches with “Teacher ▾”.

The list was put together from six research passes over web search results. YouTube’s own pages, Reddit and the roundup articles could not be opened, so the list is a map, not a guarantee: names can differ slightly from the exact YouTube title, most entries have no @handle (the link then searches for the name), and the descriptions are short. Who teaches is filled in only where a source stated it with a pronoun or a role, never from a name; one source gives a reading with a “?”, two agreeing sources (or a very well-known teacher) are shown without one. Entries that were only brand pages, kids’ content or names that could not be tied to a real channel were left out.

The list also makes searches more varied: the teachers named in searches now come from it, narrowed toward the voice, style and muscles you asked for (never a known man when you asked for a woman, and the other way round). The five-tab menu fits a phone as a bar at the bottom.

## 0.9.0

**A female or male teacher.** Today has a “Teacher” choice next to Style (Any · Female · Male; it is remembered), the Library has a Teacher filter (Female · Male · Not known yet), and typing it works too (“15 min tight hips with a female teacher”, “male instructor”). A teacher known to be the other one is left out; a teacher nobody knows about is still offered, only after the ones that fit, so a fresh start never ends up empty.

YouTube doesn’t say who is teaching, so the app answers from what is written down, best evidence first, and it never guesses from a name: **what you tell it** (“Teacher ▾” on a video: a woman, a man, or both; it applies to the whole channel and always wins; Settings lists them and takes them back), a **short list of well-known teachers**, what the **video’s own description** says outright (“she/her”, “female yoga teacher”, “husband and wife”), and what **viewers** say about the teacher in comments (“her voice”, “love him”, “thank you ma’am”) when they clearly agree, with the evidence in the badge’s tooltip. A reading that is only a guess is shown with a “?”. Analysis moved to v6 (stored text is re-read once on load).

## 0.8.0

**Olympus.** The app is now called Olympus (it was Atlas, and Unfurl before that), with a new mark: the mountain of the gods, its summit in front of the sun and wrapped in layers of cloud, in the app’s own green. It is the tab icon and the one in the header. Technical names (`UNFURL_*` settings, the data folder, Docker volumes, the `X-Unfurl` header) keep their old spelling so nothing that exists has to move.

**Picture quality.** When a video starts playing the app asks YouTube for the highest picture it has, and under the player it shows what you actually get (“720p · up to 1080p”). YouTube makes the final decision (it looks at the size of the player, your connection and your own choice in the player’s ⚙ menu) and its embedded player may ignore the request, so Settings → Video explains how to fix it for good: pick the quality once in the ⚙ menu and YouTube remembers it. There is a switch to turn the request off.

**A more polished look.** The same green design, tightened: one type scale and a bundled Inter typeface, so it looks the same on every device; a translucent header with a pill-shaped menu; consistent buttons, chips and fields with proper focus rings; cards that lift on hover and a play button on thumbnails; calmer motion (all of it off if your system asks for less motion); the follow-along controls grouped (move around · options · “I did it”); the Library rows no longer squeeze their text beside the buttons; the dark theme and the browser’s own controls follow the system.

## 0.7.0

**What kind of routine is it?** Every video now gets an estimate of its discipline and kind (Yoga: Hatha, Vinyasa/flow, Power, Ashtanga, Iyengar, Kundalini, Yin, Restorative, Yoga nidra, Chair yoga · Pilates: mat, wall, reformer · stretching · mobility · foam rolling · rehab/physio · tai chi/qigong · barre · meditation · workout), with the **evidence** behind it, how sure it is, and what else it could be. It reads the title, channel name, tags, description, chapters, the poses it names (Sanskrit names, classic Pilates exercises, yin poses), hold times mentioned, viewers' comments and, if you added one, the transcript. Many weak hints ("relax", "tight") cannot add up to a kind; a specific kind needs at least one decisive word. A badge on cards and rows, a section in *Look at a video first*, a **Style** filter in the Library and many more styles under Today's style chips, and typed requests such as “wall pilates” or “foam rolling” work. Wrong? Pick the real kind and it is remembered (and survives every re-analysis). Also **how it feels**: slow or flowing, gentle or challenging, hold lengths, floor or standing or seated, props, and (with a transcript) whether the teacher talks you through it. The teacher's usual kind is shown too. The analysis version went up, so everything already stored is re-read on first start; nothing is fetched again.

**The order of a routine.** Sections come from the chapter list; without one, from what the teacher says (transcript with times) or from the times viewers wrote in comments (“12:30 pigeon is where it clicked”).

**Follow along.** Under the player on Today: Now / Next, jump to any section, back or forward a section or 10 s, repeat this section, slower or faster, keep the screen on (where the browser allows it), and a focus view with just the video. It notes which seconds you actually played; “I did it” tells you how much that was and which sections you skipped, and the entry in your training log keeps it (“played 12 min of 15 (80%) · skipped 1 section”).

**Collections.** Your own groups of library videos (“Morning”, “After a run”). Put a video in several from “Collections ▾”, filter the Library by one, order it, play it in order, ask Today for just that collection, rename, delete (with undo). They are part of your data and your backups.

**Body map.** An optional front/back figure beside the muscle chips (closed by default; Today and Settings → My body). A tap does what a chip tap does (tight, weak, off); both always agree; it works from the keyboard.

**Looks.** Larger thumbnails; shimmering outlines instead of a bare spinner while a routine or a report is being looked for; friendlier empty states with a picture and a next step (Library, Journal, nothing found).

## 0.6.0

**Atlas.** The app has a new name. Its look is the one it always had; only the name changed, and it now lives in one constant (`js/brand.js`) plus a few lines of `index.html`, so renaming it again is a small job. Technical names (`UNFURL_*` settings, the data folder, Docker volumes, the `X-Unfurl` header) keep their old spelling so nothing that exists has to move.

**Library: your videos come first.** Adding, importing a playlist or a teacher, looking at a video first and “let the app go looking” sit in one collapsed menu under the heading, so your videos are the first thing you see (it opens by itself only while there is nothing to show yet).

**The Strength section is gone.** Versions 0.4 and 0.5 briefly carried a Strength tab (an exercise catalogue, a workout builder, plans, a set logger) and an optional AI coach. They were removed again, together with the Greek and blue/grey looks that came with them, and the app is back to stretching, yoga and stability. If your data was saved by those versions, the first start of this one removes the strength workouts, plans, sessions and weekly strength goal from it, says so once, and keeps a copy of your data from just before (Settings → Your data → Backups, “before-strength-removal”).

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
