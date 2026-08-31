// Orchestrator: pull all uploads -> parse -> write structured data files.
//
//   npm run sync
//
// Outputs (in data/):
//   games.json         all parsed game videos (high + medium confidence)
//   review.json        rows that need a human glance (low confidence / flags)
//   videos.raw.json    raw pull cache (gitignored)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorize, fetchAllUploads } from "./youtube.js";
import { parseVideo } from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

async function writeJson(name, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2));
}

console.log("Authorizing…");
const auth = await authorize();

console.log("Fetching uploads (this pages through the whole channel)…");
const raw = await fetchAllUploads(auth, {
  onProgress: (n) => process.stdout.write(`\r  fetched ${n} videos…`),
});
process.stdout.write("\n");
await writeJson("videos.raw.json", raw);

const parsed = raw.map(parseVideo);
const games = parsed.filter((r) => r.isGame && r.confidence !== "low");
const review = parsed.filter((r) => !r.isGame || r.confidence === "low");

// Group high/medium games by team so the summary is legible.
const byTeam = {};
for (const g of games) {
  const key = g.teamA || "(unknown)";
  (byTeam[key] ??= []).push(g);
}

await writeJson("games.json", games);
await writeJson("review.json", review);

const counts = { high: 0, medium: 0 };
for (const g of games) counts[g.confidence]++;
const flagTally = {};
for (const r of parsed) for (const f of r.flags) flagTally[f] = (flagTally[f] || 0) + 1;

console.log("\n=== Sync summary ===");
console.log(`Total uploads:      ${raw.length}`);
console.log(`Parsed as games:    ${games.length}  (high ${counts.high}, medium ${counts.medium})`);
console.log(`Needs review:       ${review.length}`);
console.log("\nFlags across all uploads:");
for (const [f, n] of Object.entries(flagTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(14)} ${n}`);
}
console.log("\nGames by 'Team A' (as titled — first team in each title):");
for (const [team, list] of Object.entries(byTeam).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}  ${team}`);
}
console.log("\nWrote data/games.json, data/review.json");
