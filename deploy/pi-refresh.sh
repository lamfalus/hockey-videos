#!/usr/bin/env bash
# Refresh video + scoresheet data and publish the site.
#
# Meant to run on the Raspberry Pi, which has BOTH the YouTube OAuth token
# (credentials/) AND the norcal-hockey data. It regenerates everything and
# pushes; GitHub Pages branch-deploy publishes docs/ automatically.
#
# It only commits when something actually changed, so it's safe to run often.
set -euo pipefail

# Repo root (this script lives in <repo>/deploy).
cd "$(dirname "$(readlink -f "$0")")/.."

# Where the norcal-hockey checkout lives on this machine.
export NORCAL_DIR="${NORCAL_DIR:-$HOME/norcal-hockey}"

# Pick up any changes pushed from elsewhere (e.g. the PC) before rebuilding.
git pull --quiet --ff-only || true

# sync (YouTube) + import-sheets (norcal) + build-site (-> docs/)
npm run refresh

if git diff --quiet -- docs data; then
  echo "$(date -u +%FT%TZ) no changes"
  exit 0
fi

git add docs data
git commit -q -m "Auto-refresh $(date -u +%FT%TZ)"
git push -q
echo "$(date -u +%FT%TZ) published update"
