# Running the auto-refresh on the Raspberry Pi

The Pi already has the norcal-hockey data and is always on, so it can do the
whole job: pull new videos, refresh scoresheet matches, rebuild the site, and
push. GitHub Pages publishes `docs/` automatically after each push — no GitHub
Actions needed.

Do this once. Replace `pi`/paths if your user or layout differ.

## 1. Prerequisites
- **Node.js 18+** and **npm**. Check: `node --version`. If missing:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **git** with push access to `github.com/lamfalus/hockey-videos` (same auth you
  use for norcal-hockey — SSH key or a stored token).

## 2. Clone and install
```bash
cd ~
git clone https://github.com/lamfalus/hockey-videos.git
cd hockey-videos
npm install
```

## 3. Copy the YouTube credentials from your PC
These are gitignored (never in the repo). From your Windows PC, copy the two
files to the Pi — e.g. with scp (adjust the Pi's hostname/IP):
```bash
# run on the PC, in the project folder:
scp credentials/client_secret.json credentials/token.json pi@raspberrypi.local:~/hockey-videos/credentials/
```
`token.json` holds a long-lived refresh token, so the Pi can call the YouTube
API without any browser step.

## 4. Point it at your norcal-hockey checkout
Confirm where norcal lives on the Pi (it needs `data/app/games/*.json`):
```bash
ls ~/norcal-hockey/data/app/games/   # should list s27.json … s33.json
```
If it's elsewhere, note that path — you'll set `NORCAL_DIR` to it in step 6.

## 5. Test a full refresh by hand
```bash
cd ~/hockey-videos
NORCAL_DIR=~/norcal-hockey npm run refresh
bash deploy/pi-refresh.sh     # should build, commit, and push (or say "no changes")
```
Then reload https://lamfalus.github.io/hockey-videos/ — it should reflect the
latest games within a minute of the push.

## 6. Install the timer (runs every 30 min)
Edit `deploy/hockey-videos-refresh.service` if your user/paths differ (the
`User=`, `WorkingDirectory=`, and `NORCAL_DIR=` lines), then:
```bash
sudo cp deploy/hockey-videos-refresh.service /etc/systemd/system/
sudo cp deploy/hockey-videos-refresh.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hockey-videos-refresh.timer
```
Check it:
```bash
systemctl list-timers hockey-videos-refresh.timer   # next scheduled run
journalctl -u hockey-videos-refresh.service -n 30    # last run's output
```

That's it. New games now appear on the site within ~30 minutes, entirely from
the Pi. Adjust `OnUnitActiveSec` in the timer for a faster/slower cadence.

## Notes
- The refresh only commits when something changed, so idle runs are cheap and
  produce no empty commits.
- If you ever revoke the YouTube authorization, re-copy `token.json` (or run
  `npm run auth` on a machine with a browser and copy the new token over).
