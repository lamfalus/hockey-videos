# Setup — DONE ✅

Google Cloud OAuth is configured and the sync works. This file documents what's
in place so you (or future-you) can maintain it.

## What's configured
- **Google Cloud project:** *My First Project* (`project-7723331b-9564-4c9a-a20`)
- **API enabled:** YouTube Data API v3
- **OAuth consent screen:** External, In production (app shows as "openclaw" — pre-existing branding, harmless)
- **OAuth client:** Desktop app named `youtube-logger`
- **Credentials (gitignored):**
  - `credentials/client_secret.json` — the OAuth client
  - `credentials/token.json` — your saved read-only authorization
- **Scope:** `https://www.googleapis.com/auth/youtube.readonly` (read-only; can't modify anything)

## Everyday use
```bash
npm run sync    # pulls all uploads, writes data/games.json + data/review.json
```
No re-auth needed — the saved token refreshes itself.

## If you ever need to re-authorize
(e.g. token revoked, or moving to a new machine)
```bash
npm run auth    # prints a consent URL, open it, approve read-only access
```
On the "Google hasn't verified this app" screen, click **Advanced → Go to
openclaw (unsafe)** — it's your own app, so this is expected and safe.

## Files
- `src/parse.js`  — title → structured game (teams, date, game #, score, confidence)
- `src/youtube.js`— OAuth + fetch all uploads (incl. Unlisted)
- `src/auth.js`   — one-time authorization (loopback OAuth flow)
- `src/sync.js`   — pull → parse → write data/
- `data/games.json`  — matched games (high + medium confidence)
- `data/review.json` — non-game clips + low-confidence rows to eyeball
