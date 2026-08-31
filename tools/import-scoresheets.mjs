// Snapshot scoresheet games from the norcal-hockey app export (all seasons)
// into data/scoresheets.json for the site build to match against.
//
// Source: the per-season game files the norcal project publishes,
//   <norcal>/data/app/games/s27.json … s33.json
// each { games: { "<game_id>": { date, homeName, awayName, hg, ag, level, ... } } }.
// A played game (score present) has a printable PDF scorecard at:
//   https://stats.caha.timetoscore.com/generate-scorecard.php?game_id=<id>
//
// Usage:  node tools/import-scoresheets.mjs [path-to-norcal-hockey]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_NORCAL = "C:\\Users\\lamfa\\Projects\\norcal-hockey";
const SCORECARD_URL = "https://stats.caha.timetoscore.com/generate-scorecard.php?game_id=";

const norcal = process.argv[2] || DEFAULT_NORCAL;
const gamesDir = path.join(norcal, "data", "app", "games");
if (!fs.existsSync(gamesDir)) {
  console.error(`norcal app games not found at ${gamesDir}`);
  process.exit(1);
}

const out = [];
for (const file of fs.readdirSync(gamesDir).filter((f) => /^s\d+\.json$/.test(f))) {
  const j = JSON.parse(fs.readFileSync(path.join(gamesDir, file), "utf8"));
  const season = j.metadata?.season;
  for (const [id, g] of Object.entries(j.games || {})) {
    if (g.hg == null || g.ag == null) continue; // unplayed -> no scorecard
    out.push({
      gameId: Number(id),
      season,
      date: g.date,
      away: g.awayName,
      home: g.homeName,
      awayGoals: g.ag,
      homeGoals: g.hg,
      level: g.level,
      url: SCORECARD_URL + id,
    });
  }
}
out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "scoresheets.json"), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} played games (with scorecards) to data/scoresheets.json`);
