# Unfurl

Find yoga and stretching routines that fit **the muscles you want to work on and the time you have**, play them right in the app, and let the app **learn what actually helps your body**.

You tell it what you need ("*15–20 min, tight hips and weak glutes, desk posture*"). It searches YouTube, reads each candidate's details, chapters and **viewer comments** to work out which muscles the routine really works and what people say it did for them, ranks the results, and plays the best one. Afterwards you tell it whether it helped; that feeds back into the next suggestion.

## Quick start

You need Python 3 (already on macOS and most Linux; [python.org](https://www.python.org/downloads/) for Windows). Nothing else to install.

```
python3 serve.py
```

It opens <http://localhost:8765>. (macOS: double-click `start.command`. Windows: double-click `start.bat`.)

It works immediately from a small built-in starter shelf. To let it **search the whole of YouTube on its own**, add a free YouTube key (below).

> Why a local server rather than just opening `index.html`? YouTube won't play embedded videos on pages opened straight from disk, and the server also keeps your history in files that survive clearing your browser.

## Getting a YouTube key (free, about 3 minutes)

1. Go to <https://console.cloud.google.com/>, sign in, create a project (any name).
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. (Recommended) Edit the key and restrict it to *YouTube Data API v3*.
5. In Unfurl: **Settings → paste → Save & test**.

The free allowance is 10,000 units a day. A web search costs about 100–400 units depending on how much digging it does (the app shows a running total in Settings), so a few dozen searches a day.

The key is stored only on your computer (`userdata/config.json`) and only ever sent to Google's YouTube API.

## Using it

- **Today**: type what you need, or tap quick picks / muscles. Tap a muscle once for *tight* (wants stretching), twice for *weak* (wants strengthening), a third time to clear it. Press **Find my routine**.
- **Another one ↻** gives a different good option; **Not for me** hides a video for good; **I did it ✓** asks whether it helped.
- **Library**: everything the app knows. It grows every time you search. **Grow library where it's thin** targets the muscle areas you have the fewest videos for. You can also paste a YouTube link you found yourself.
- **Journal**: your history, plus per-muscle patterns: which exercises and teachers have helped which muscles for *you*.
- **Settings**: the key, how adventurous the app is (favourites ↔ surprise me), trusted teachers, backup/restore.

## How it works

```
what you typed ─► parse (muscles, tight/weak, length, style)
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
  ranking = how well it matches your muscles
          + quality (likes, views, comment sentiment, teacher trust)
          + what YOUR history predicts
          + novelty (new teachers, "hidden gems"), then length / style / recency
```

Every suggestion shows **why** it was picked (which exercises, which comments) and a score breakdown.

### What it learns from you

When you finish a routine you say, per muscle, *much better / a little / not really*, plus intensity and "show again?". The app credits that answer to the **specific exercises in the video that work that muscle**, the teacher, and the style. So if pigeon pose keeps helping your glutes, *other* videos containing pigeon pose rise for glutes, and the Journal says so. Ratings are rebuilt from your history each time, so deleting an entry removes its influence. "Too hard" answers nudge it toward gentler videos; "Never show again" is permanent.

## Honest limitations

- **English only** for now (search and text analysis).
- The "intelligence" is transparent keyword and heuristic analysis (anatomy tables in `js/lexicon.js`), not a language model. It can be fooled by clickbait titles; the comment evidence and your own ratings are what correct it. Comments are noisy; small sample sizes are labelled "early signal".
- The built-in starter videos came from web search results, not the YouTube API, so their channel names and lengths are best guesses until verified. The app checks them against YouTube the first time you search with a key, fixes them, and hides any that no longer exist; the player also corrects a video's length when you open it.
- Muscle tags are inferred, not medically reviewed. **This isn't medical advice**: stop if something hurts, and see a professional for persistent pain, numbness or sciatica.
- Uses only the official YouTube Data API and embedded player. It doesn't scrape YouTube or download video.

## Your data

Everything lives in `userdata/` (git-ignored): `state.json` (library, history, learned data) and `config.json` (your key). **Settings → Export backup** gives a JSON file (never containing the key). If you open the app without the server it falls back to browser storage.

## Development

```
npm test           # 68 unit tests, no dependencies (Node 18+)
npm i && npm run test:e2e   # real Chromium + real server (needs Playwright)
```

YouTube is never contacted by the tests: `tests/helpers/fake-youtube.js` is a stand-in for the Data API with the real response and error shapes, and the e2e test stubs the embedded player.

```
index.html, css/       the app shell
js/lexicon.js          muscle areas, pose → muscle tables, sentiment words
js/analyze.js          video text + comment analysis → profiles
js/query.js            command parser, query generator
js/youtube.js          Data API client, discovery pipeline, quota
js/model.js            ranking + learning
js/state.js, store.js  data shape and persistence
js/views/              Today, Library, Journal, Settings, feedback dialog
serve.py               local server (static files + saving to disk)
data/starter.js        the small starter shelf
```
