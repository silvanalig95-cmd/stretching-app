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
