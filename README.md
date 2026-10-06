# Atlas

> The app used to be called Unfurl. Its settings names (`UNFURL_…`), the data folder and the Docker volumes keep the old spelling so nothing that exists has to move. The name itself lives in one constant, `js/brand.js`, and a few lines of `index.html`.

Find yoga and stretching routines that fit **the muscles you want to work on and the time you have**, play them right in the app, and let the app **learn what actually helps your body**.

You tell it what you need ("*15–20 min, tight hips and weak glutes, desk posture*"). It searches YouTube, reads each candidate's details, chapters and **viewer comments** to work out which muscles the routine really works and what people say it did for them, ranks the results, and plays the best one. Afterwards you tell it whether it helped; that feeds back into the next suggestion.

## Quick start

You need Python 3 (already on macOS and most Linux; [python.org](https://www.python.org/downloads/) for Windows). Nothing else to install.

```
python3 serve.py
```

It opens <http://localhost:8765>. (macOS: double-click `start.command`. Windows: double-click `start.bat`; to use it from your other devices at home too, see [deploy/WINDOWS.md](deploy/WINDOWS.md).)

It works immediately from a small built-in starter shelf. To let it **search the whole of YouTube on its own**, add a free YouTube key (below).

> Why a local server rather than just opening `index.html`? YouTube won't play embedded videos on pages opened straight from disk, and the server also keeps your data in files that survive clearing your browser and updating the app.

## Getting a YouTube key (free, about 3 minutes)

1. Go to <https://console.cloud.google.com/>, sign in, create a project (any name).
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. Under **API restrictions** choose **Restrict key → YouTube Data API v3**. Leave *Application restrictions* on **None** (the app calls YouTube from your own browser).
5. In the app: **Settings → paste → Save & test**.

The free allowance is 10,000 units a day. A web search costs about 100–400 units depending on how much digging it does (the app shows a running total in Settings), so a few dozen searches a day.

The key is stored only on your computer (in your data folder, below) and only ever sent to Google's YouTube API.

## Using it

- **Today**: type what you need ("*15–20 min, tight hips and weak glutes, desk posture*"; add a pose or a teacher too: "*pigeon pose, 20 min*", "*Kassandra neck*"), or tap muscles. Tap a muscle once for *tight* (wants stretching), twice for *weak* (wants strengthening), a third time to clear it. Press **Find my routine**.
  - **Another one ↻** gives a different good option; **＋ Add to library** keeps it; **Not for me** hides it for good; **I did it ✓** asks whether it helped.
  - **Your body**: "Use my usual spots", and "What have I been neglecting?", which aims at the spots you've gone longest without working.
  - **Pick from**: everything the app knows, or only your library.
- **Library**: yours to build, in three shelves:
  - **My library**: videos you chose. Starts empty. Add by pasting links, pressing "＋ Library" anywhere, or just doing a routine. Add tags and notes; search covers them.
  - **Discovered**: everything the app's searches and imports found. Used for suggestions; promote the ones you like.
  - **Suggestions**: a small starter shelf of well-known routines.
  - **Look at a video first**: paste one video link and the app reads it (title, description, chapters, tags, and — with a key — the viewer comments) and shows a report: which muscles it works and *why* (in the title? the chapter list? which exercises? what commenters say), the exercises it contains, the chapter list, what viewers report it did for them, its quality signals (likes, hidden gem, trusted or new teacher), and **how it fits you** (your standing tight/weak spots it covers or misses, and gaps in your library it would fill). Nothing is kept until you press **Add to my library** (or *Add and do it now*). It reads text, not footage: muscle tags are inferred, and the report says so. Without a key it can only read the title and says that its analysis is thin.
  - The box below it takes **video links, playlists, and teachers** (a channel link, an @handle, or just a name). A teacher's whole catalogue costs about 1 quota unit per 50 videos; you can **follow** a teacher and check for new uploads later.
  - **How hard to look**: *Quick / Balanced / Thorough / Exhaustive*. A search is a **wide net**: it runs several differently-worded YouTube searches, reads further pages when results are mostly familiar, learns new wording from the best hits, and keeps going in rounds until enough *strong fits* turn up (or the unit budget for that run is spent). Balanced typically weighs a few hundred videos for ~300 units; the setting caps what one search may cost.
  - **Build a combo** (offered when you pick two or more muscle areas): no single video usually covers them all, so it chains 2–3 short, well-fitting ones into one session that fits your time, shows how much of your list it covers versus the best single video, and plays them back to back.
- **Searching your library** (Library tab): plain words find titles, teachers, chapters, poses, muscles, what viewers wrote, and your own tags and notes, with typo tolerance, synonyms ("glutes" ≈ "buttocks"), and suggestions as you type. Extra syntax: `"exact phrase"`, `-word` to exclude, `teacher:kassandra`, `pose:pigeon`, `tag:morning`, `for:hips`, `len:10-20` / `len:<15`. The line under the box shows how it understood you. Save a search you use often and it appears as a chip.
- **Journal**: your **training log** (this week against a goal, streaks, a 12-week chart, a calendar, achievements, per-muscle progress, a one-click “✓ Did today” on any video, log things without a video or for an earlier day, CSV export), what's working for you per muscle, a 4-week map of which muscles you've been working, and your history.
- **Settings**: the key, your standing tight/weak spots, how adventurous the app is, auto-add, backups.

## How it works

```
what you typed ─► parse (muscles, tight/weak, length, style, free-text words)
        │
        ▼
  query generator ─► YouTube search (varied wording, teachers, sort order,
        │            result pages; remembers what it has already tried and
        │            looks further down when results are mostly familiar)
        ▼
  video details + channel size ─► text analysis (title, description, chapters,
        │                          tags, named poses → muscles worked)
        ▼
  viewer comments ─► which muscles do people say it helped? ("my sciatica is
        │            so much better", "didn't help my hips"), pace, benefits
        ▼
  local search index ─► BM25 over all of the above + your tags and notes
        ▼
  ranking = how well it matches your muscles (+ typed words)
          + quality (likes, views, comment sentiment, teacher trust)
          + what YOUR history predicts
          + novelty (new teachers, "hidden gems"), then length / style / recency
```

Every suggestion shows **why** it was picked (which exercises, which comments) and a score breakdown.

### What it learns from you

When you finish a routine you say, per muscle, *much better / a little / not really*, plus intensity and "show again?". The app credits that answer to the **specific exercises in the video that work that muscle**, the teacher, and the style. So if pigeon pose keeps helping your glutes, *other* videos containing pigeon pose rise for glutes, and the Journal says so. Ratings are rebuilt from your history each time, so deleting an entry removes its influence. "Too hard" answers nudge it toward gentler videos; "Never show again" removes the video from your library and blocks it.

## Your data, and updating the app

Your data is **outside the app folder**, so updating, replacing or re-downloading the app can't touch it:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/Unfurl` |
| Windows | `%APPDATA%\Unfurl` |
| Linux | `~/.local/share/unfurl` |

The exact path is printed when the server starts and shown under **Settings → Your data**. Override it with `--data-dir /some/folder` or the `UNFURL_DATA` environment variable.

```
profile.json   your library, history, ratings, preferences  (small; this is what's backed up)
index.json     every video the app has discovered + its analysis (rebuildable)
config.json    your API key (private)
backups/       a daily backup of profile.json, plus one before every data-format upgrade
```

- **Upgrading from 0.1**: on first launch your old `./userdata` files are copied to the new location and converted (the originals stay where they were). Videos you saved or did, and ones you pasted, become your library.
- **A new version that changes the data format** upgrades it automatically *after* backing up the old format. Run an older app on newer data and it opens it **read-only** instead of risking damage.
- **Damaged file?** It's set aside (never deleted) and the latest backup is restored automatically. **Settings → Your data** lists all backups with one-click restore (what you replace is kept too).
- **Moving to another computer**: copy the data folder, or use **Export backup / Import backup**. Backups never contain your API key.
- The analysis keeps getting better: when it changes, the app re-analyses everything you already have from the text and comments it stored; nothing is re-fetched.

See `CHANGELOG.md` for the exact promise.

## Running it on a server (shared, always on, self-updating)

Everything above also works as an internal website for you, your household or a team: logins (one shared, or one per person each with their own library), HTTPS via a reverse proxy, an optional **server-held YouTube key** so nobody needs their own, and — the point of it — **automatic updates**: the server follows a git branch, and when a new version is pushed it tests it, switches to it, health-checks it and **rolls back by itself** if anything is wrong. Open pages offer a one-click reload. Your data lives in its own folder and is never touched.

```
sudo deploy/install.sh --branch main --host unfurl.internal      # Linux + systemd
docker compose -f deploy/docker-compose.yml up -d --build        # or Docker
```

Full guide, including HTTPS, private repositories, SSO and operations: **[deploy/README.md](deploy/README.md)**. On Windows: **[deploy/WINDOWS.md](deploy/WINDOWS.md)**. Letting friends use it from outside your network: **[deploy/EXTERNAL.md](deploy/EXTERNAL.md)**. Backing up to the cloud (what to include, Proton Drive, restoring): **[deploy/BACKUP.md](deploy/BACKUP.md)**.

## Honest limitations

- **English only** for now (search and text analysis).
- The "intelligence" is transparent keyword and heuristic analysis (anatomy tables in `js/lexicon.js`), not a language model. It can be fooled by clickbait titles; the comment evidence and your own ratings are what correct it. Comments are noisy; small sample sizes are labelled "early signal".
- The suggested starter videos came from web search results, not the YouTube API, so their channel names and lengths are best guesses until verified. The app checks them against YouTube the first time you search with a key, fixes them, and hides any that no longer exist; the player also corrects a video's length when you open it.
- **Sources**: YouTube only, through its official API. Reddit and other forums, Vimeo, Instagram etc. are not included: they have no reliable open API for this (Reddit now needs its own credentials; the rest are not searchable for exercise content).
- Muscle tags are inferred, not medically reviewed. **This isn't medical advice**: stop if something hurts, and see a professional for persistent pain, numbness or sciatica.
- Uses only the official YouTube Data API and embedded player. It doesn't scrape YouTube or download video.

## Development

```
npm test           # unit, storage-server, hosting and auto-update tests, no dependencies (Node 18+, needs python3, git and bash)
npm i && npm run test:e2e   # real Chromium + real server (needs Playwright)
npm run bench      # timings with a synthetic 2,000-video library (the most the app keeps); tests/unit/perf.test.js guards them
```

YouTube is never contacted by the tests: `tests/helpers/fake-youtube.js` is a stand-in for the Data API with the real response and error shapes, and the e2e test stubs the embedded player.

```
index.html, css/       the app shell
js/lexicon.js          muscle areas, pose → muscle tables, sentiment words
js/analyze.js          video text + comment analysis → profiles
js/query.js            command parser, query generator
js/youtube.js          Data API client, discovery pipeline, quota
js/model.js            ranking + learning
js/index.js            local BM25 search index
js/state.js            data shape, upgrades between versions, library rules
js/store.js            saving/loading (server files or browser storage), backups
js/report.js           the readable analysis behind "Look at a video first"
js/views/              Today, Library, Journal, Settings, feedback dialog
serve.py               server (static files, saving to disk, logins, shared YouTube key, --selftest)
deploy/                hosting kit: update.sh (self-update + rollback), run.sh (supervisor), install.sh, Dockerfile, systemd unit
data/suggestions.js    the small suggested-videos shelf
```

### Changing the analysis or the data format

- Changed how videos are analysed (lexicon, weights, parsing)? **Bump `ANALYSIS_VERSION`** in `js/analyze.js`. Users' stored videos are re-analysed on next launch.
- Changed the shape of the profile? **Bump `SCHEMA`** in `js/state.js`, add a step to `PROFILE_MIGRATIONS`, and add a test with a saved sample of the old shape. Never edit old steps.
- Added suggested videos? Bump `SUGGESTIONS_VERSION` in `data/suggestions.js`; new ids are added to existing installs and nothing else changes.
