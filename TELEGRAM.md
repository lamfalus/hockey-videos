# Auto-posting new games to a Telegram channel

When the Pi's refresh finds a **new** upload, `src/notify.js` posts it to a
Telegram channel — one message per game, with the Watch link and (if matched)
the scoresheet link. It stays dormant until configured, and on its first
configured run it **seeds** with all existing videos so your backlog is never
posted — only genuinely new uploads go out afterward.

## One-time setup

### 1. Make the bot (in Telegram, chat with **@BotFather**)
- Send `/newbot`, pick a name and a username ending in `bot`.
- BotFather replies with a **token** like `123456789:ABC…`. Keep it secret.

### 2. Make the channel and add the bot
- Create a **private channel** (see the family/team join-link notes).
- Channel → **Manage → Administrators → Add Admin** → add your bot, with the
  **Post Messages** permission. (Members stay read-only; only admins post.)

### 3. Find the channel's chat id
Private channels have no username, so the notifier needs the numeric id
(looks like `-1001234567890`). Easiest: **post any message in the channel**,
then either forward it to **@userinfobot**, or let me fetch it for you from the
bot's `getUpdates` once the bot is an admin.

### 4. Drop the config on the Pi (kept out of git)
Create `credentials/telegram.json` on the Pi — one bot, one entry per channel,
each with its own filter:
```json
{
  "botToken": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyz",
  "channels": [
    { "chatId": "-1004490810022", "name": "Cougars 12-1", "team": "Cougars 12-1" }
  ]
}
```
Per channel, pick **one** filter:
- `"team": "Cougars 12-1"` — only that specific team (a game matches if either
  side's name contains all those words; excludes "Cougars 12-2", "10U Cougars", …)
- `"club": "cougars"` — any Cougars team (ids: `cougars`, `gse`, `sharks`, `blazers`, `delta`)
- `"all": true` — every new game

Add more channels by adding more entries (same bot, added as admin to each).

That's it. The next refresh seeds each channel silently; the one after a new
matching upload posts it.

## Test / operate
```bash
node src/notify.js     # manual run: seeds on first configured run, else posts new
```
- State lives in `data/announced.json` (Pi-local, gitignored). Delete it to
  re-seed; on a fresh Pi it re-seeds automatically (so no double-posts).
- A failed send leaves that video un-announced, so it retries next cycle.
- Posts include the YouTube link, so Telegram shows the video thumbnail preview.
