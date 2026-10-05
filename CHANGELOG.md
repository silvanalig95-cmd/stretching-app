# Changelog

## The data promise

Your library, history and ratings are never left behind by an update:

- They live **outside the app folder** (see the README for where), so replacing, re-downloading or `git pull`ing the app can't touch them.
- Every data file carries a **format version**. A newer app upgrades older data automatically, **after saving a backup of the old format**.
- An **older** app that meets data from a newer version refuses to write to it (it shows it read-only), so downgrading can't damage anything.
- When the **analysis** gets smarter, the app re-analyses everything you already have from the raw text and comments it stored; nothing is re-fetched and nothing is lost.
- A damaged file is set aside (never deleted) and the latest good backup is restored.

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
