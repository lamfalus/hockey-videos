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
                     src/build-site.js
                              │
                     site/index.html   (self-contained, filterable by club/year)
                              │
                    GitHub Pages (.github/workflows/deploy.yml)
```

## Commands

```bash
npm install
npm run auth          # one-time: authorize read-only YouTube access
npm run sync          # pull all uploads -> data/games.json + review.json
npm run import-sheets # snapshot scoresheet PDFs from the norcal-hockey export
npm run build-site    # -> site/index.html (self-contained)
npm run refresh       # sync + import-sheets + build-site in one go
```

## Notes

- Videos are **unlisted**; the site carries a `noindex` tag and `robots.txt`
  disallow so the links aren't search-indexed.
- Secrets (`credentials/`) are gitignored and never committed.
- Title-parsing and scoresheet-matching logic, with the edge cases they handle,
  are documented inline in `src/parse.js` and `src/build-site.js`.

See [SETUP.md](SETUP.md) for the one-time Google Cloud / OAuth setup.
