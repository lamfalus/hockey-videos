# YouTube Logger — hockey game videos

Pulls every game video from a YouTube channel, parses the title into structured
game data (teams, date, game #, score), matches each to its official
timetoscore scoresheet PDF, and publishes a small filterable website.

**Live site:** https://lamfalus.github.io/hockey-videos/

## How it works

```
YouTube Data API ──▶ src/sync.js ──▶ data/games.json     (all uploads, parsed)
norcal-hockey export ─▶ tools/import-scoresheets.mjs ─▶ data/scoresheets.json
                              │
                     src/build-site.js   (match videos ↔ scoresheets)
                              │
                     docs/index.html   (self-contained, filterable by club/year)
                              │
        Raspberry Pi (deploy/pi-refresh.sh, every 30 min): refresh → push
                              │
            GitHub Pages serves docs/   +   Telegram per-team channels (src/notify.js)
```

The whole pipeline runs on a Raspberry Pi: `pi-refresh.sh` pulls new uploads,
rebuilds, pushes `docs/` (GitHub Pages republishes), and posts any new game to
its team's Telegram channel. See [SETUP-PI.md](SETUP-PI.md) and
[TELEGRAM.md](TELEGRAM.md).

## How matching works

Two independent inputs are joined into one row per game:

**1 — Parse the title** (`src/parse.js`). Each video title is split on `vs` into
two teams; a date is pulled out of any of the formats these titles use
(`YYYY-MM-DD`, `YYYY MM DD`, US `M-D-YY`/`M-D-YYYY`, `D-Mon-YYYY`, even a swapped
`YYYY-DD-MM`), the game number and scrimmage flag are read, and the result
(`Win 7-1` / `OT Loss 2-3`) comes from the description. Each parse carries a
`confidence` and `flags`; clips with no `vs` are set aside as non-games.

**2 — Group into clubs** (`src/build-site.js`). Team names are reduced to a
canonical, order/case/punctuation-independent key, then mapped to the family's
clubs (Cougars, Golden State Elite, Jr. Sharks, Blazers, Delta Knights) — a game
counts for a club if **either** side matches, so games where our team is listed
second still show up and opponents never become filter entries.

**3 — Match the scoresheet** (`src/build-site.js`). For each game, candidate
timetoscore scorecards are found by **date proximity** (±1 day, ±2 when the date
came from the upload) and **team identity**, then the best is chosen:

- token overlap, with a **weak-token stoplist** (`jr`, `san`, `jose`, …) so two
  teams aren't matched on a common word alone;
- an **abbreviation matcher** — `TVBD` → Tri Valley Blue Devils via word
  initials, or `SCBH` → Santa Clara **BlackHawks** via letters inside a compound
  word (restricted to vowelless tokens so real words like "stars" don't match);
- **age / tier guards** — `12AAA` never matches `14AA` or a `12AA` team, because
  the age (12 vs 14) or tier (AAA vs AA) conflicts;
- **gender** judged per *game* from the scoresheet's division (`Girls 12AAA`),
  not per opponent name — so an abbreviated opponent ("Tri Valley 12AAA" for
  "Tri Valley Lady Blue Devils") doesn't break the match;
- the recorded **score** is a tiebreaker (not a gate — a mistyped score never
  hides a link): among candidates, one whose score agrees wins.

It leans toward showing a close match over a perfect one; a game with no
confident match simply shows a Watch link and no Scoresheet link.

## Commands

```bash
npm install
npm run auth          # one-time: authorize read-only YouTube access
npm run sync          # pull all uploads -> data/games.json + review.json
npm run import-sheets # snapshot scoresheet PDFs from the norcal-hockey export
npm run build-site    # -> docs/index.html (self-contained)
npm run refresh       # sync + import-sheets + build-site in one go
```

## Notes

- Videos are **unlisted**; the site carries a `noindex` tag and `robots.txt`
  disallow so the links aren't search-indexed.
- Secrets (`credentials/`) are gitignored and never committed.
- Title-parsing and scoresheet-matching logic, with the edge cases they handle,
  are documented inline in `src/parse.js` and `src/build-site.js`.

See [SETUP.md](SETUP.md) for the one-time Google Cloud / OAuth setup,
[SETUP-PI.md](SETUP-PI.md) to run the auto-refresh on the Raspberry Pi (every
30 min, no GitHub Actions), and [TELEGRAM.md](TELEGRAM.md) to auto-post new
games to a Telegram channel.
