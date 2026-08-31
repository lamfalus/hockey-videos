// Build the static site's data file from data/games.json.
// Emits site/games-data.js as `window.GAMES = [...]` so the page works even
// when opened directly from disk (no server / no fetch-CORS needed).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const games = JSON.parse(await fs.readFile(path.join(ROOT, "data", "games.json"), "utf8"));

// Canonical team key: case/punctuation/word-order-independent, so that
// "GSE 12AA-1", "12AA GSE-1", and "GSE 12aa-1" all collapse to one team.
// Conservative — only merges names with the identical set of tokens.
function teamKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");
}

// The family's clubs. A game belongs to a club if EITHER team in the title
// matches — so games where our team is listed second still count, and one-off
// opponents never become filter entries. Golden State Elite absorbs GSE/GSEE
// and the Eagles (Bay Area Eagles / Bay Eagles / GSE Eagles).
const CLUB_DEFS = [
  { id: "cougars", label: "Cougars", re: /cougar/i },
  { id: "gse", label: "Golden State Elite", re: /\bgsee?\b|golden state|eagles/i },
  { id: "sharks", label: "Jr. Sharks", re: /sharks/i },
  { id: "blazers", label: "Blazers", re: /blazers?/i },
  { id: "delta", label: "Delta Knights", re: /delta\s*knights/i },
];

function clubsFor(a, b) {
  const hit = CLUB_DEFS.filter((c) => c.re.test(a) || c.re.test(b)).map((c) => c.id);
  return hit.length ? hit : ["other"];
}

// --- Scoresheet (PDF) matching ------------------------------------------
// Fuzzy-match a YouTube game to a timetoscore scorecard from the norcal DB
// snapshot (data/scoresheets.json, produced by tools/export-scoresheets.py).
// Matches on date proximity + team identity, tolerant of abbreviations
// ("TVBD" = Tri Valley Blue Devils). Leans toward showing a close match;
// a wrong one is acceptable, a lone weak/generic token match is not.
const SHEET_DROP = new Set(["aaa","aa","a","bb","b","cc","c","girls","boys","coed","u"]);
const SHEET_WEAK = new Set(["jr","san","jose","bay","area","the","of","ca","team"]);
const sheetToks = (name) =>
  (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
const sheetSig = (name) =>
  new Set(sheetToks(name).filter(
    // Drop pure numbers and age/division codes (12aa, 16aa, 13aaa, 10u, 10g, 10b)
    // so teams aren't matched merely by sharing a division.
    (t) => !/^\d+$/.test(t) && !/^\d+[a-z]{1,3}$/.test(t) && !SHEET_DROP.has(t)
  ));
const sheetInitials = (name) => sheetToks(name).filter((t) => /[a-z]/.test(t)).map((w) => w[0]).join("");
function isSubseq(sub, seq) { let i = 0; for (const ch of seq) if (ch === sub[i]) i++; return i === sub.length; }
function sheetSide(ytSet, dbSet, dbName) {
  let nonWeak = 0, weak = 0;
  for (const t of ytSet) if (dbSet.has(t)) (SHEET_WEAK.has(t) ? weak++ : nonWeak++);
  let abbrev = false;
  if (nonWeak === 0) {
    const init = sheetInitials(dbName);
    // ≥3 letters: 2-letter "abbreviations" (e.g. a "(LB)" note) match too loosely.
    for (const t of ytSet) if (t.length >= 3 && t.length <= 4 && isSubseq(t, init)) { abbrev = true; break; }
  }
  return { ok: nonWeak >= 1 || abbrev || nonWeak + weak >= 2, nonWeak, score: nonWeak * 3 + weak + (abbrev ? 2 : 0) };
}
function dayDiff(a, b) { return Math.abs(new Date(a + "T00:00Z") - new Date(b + "T00:00Z")) / 86400000; }

function makeSheetMatcher(sheets) {
  const withSig = sheets.map((s) => ({ ...s, hSig: sheetSig(s.home), vSig: sheetSig(s.away) }));
  return function bestSheetUrl(g) {
    if (!g.teamA || !g.teamB || !g.date) return null;
    const A = sheetSig(g.teamA), B = sheetSig(g.teamB);
    const window = g.dateSource === "upload" ? 2 : 1;

    // Every sheet that matches by date + both teams becomes a candidate.
    const cands = [];
    for (const s of withSig) {
      const dd = dayDiff(g.date, s.date);
      if (dd > window) continue;
      let bestRank = -Infinity;
      for (const [x, xName, y, yName] of [
        [s.vSig, s.away, s.hSig, s.home], // A~away, B~home
        [s.hSig, s.home, s.vSig, s.away], // A~home, B~away
      ]) {
        const a = sheetSide(A, x, xName), b = sheetSide(B, y, yName);
        if (a.ok && b.ok && a.nonWeak + b.nonWeak >= 1) {
          bestRank = Math.max(bestRank, a.score + b.score - dd * 0.5);
        }
      }
      if (bestRank > -Infinity) cands.push({ s, rank: bestRank });
    }
    if (!cands.length) return null;

    // Score as a tiebreaker (not a gate): when the video records a score,
    // prefer a candidate whose score agrees — this disambiguates same-name
    // games in different divisions. Falls back to the best team/date match.
    const vf = g.result?.for, va = g.result?.against;
    if (vf != null && va != null) {
      const vkey = [vf, va].sort((a, b) => a - b).join("-");
      const agree = cands.filter(
        (c) => [c.s.awayGoals, c.s.homeGoals].sort((a, b) => a - b).join("-") === vkey
      );
      if (agree.length) { agree.sort((a, b) => b.rank - a.rank); return agree[0].s.url; }
    }
    cands.sort((a, b) => b.rank - a.rank);
    return cands[0].s.url;
  };
}

// Optional scoresheet snapshot — absent is fine (feature just stays off).
let bestSheetUrl = () => null;
let sheetCount = 0;
try {
  const sheets = JSON.parse(await fs.readFile(path.join(ROOT, "data", "scoresheets.json"), "utf8"));
  bestSheetUrl = makeSheetMatcher(sheets);
  sheetCount = sheets.length;
} catch { /* no scoresheets.json yet */ }

// Keep only what the page needs, newest game first.
const slim = games
  .filter((g) => g.teamA && g.teamB)
  .map((g) => ({
    videoId: g.videoId,
    url: g.url,
    date: g.date,
    dateSource: g.dateSource,
    teamA: g.teamA,
    teamB: g.teamB,
    teamKey: teamKey(g.teamA),
    clubs: clubsFor(g.teamA, g.teamB),
    sheetUrl: bestSheetUrl(g),
    gameNum: g.gameNum,
    scrimmage: g.isScrimmage,
    source: g.source,
    result: g.result, // { outcome, for, against } | null
    confidence: g.confidence,
    title: g.title,
    flags: g.flags,
  }))
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

// Build the club facet: one entry per family club, ordered by most-recent
// game so the clubs you're actively recording rise to the top.
const LABELS = Object.fromEntries(CLUB_DEFS.map((c) => [c.id, c.label]));
LABELS.other = "Other / tournaments";
const clubMap = {};
for (const g of slim) {
  for (const id of g.clubs) {
    const c = (clubMap[id] ??= { id, count: 0, lastDate: "" });
    c.count++;
    if ((g.date || "") > c.lastDate) c.lastDate = g.date || "";
  }
}
const clubs = Object.values(clubMap)
  .map((c) => ({ id: c.id, label: LABELS[c.id] || c.id, count: c.count, lastDate: c.lastDate }))
  .sort((a, b) => {
    if (a.id === "other") return 1; // keep "Other" last regardless of recency
    if (b.id === "other") return -1;
    return (b.lastDate || "").localeCompare(a.lastDate || "");
  });

// Inject the data straight into the template so the output is ONE
// self-contained index.html — works when double-clicked, previewed, or hosted
// (no separate data file to 404).
const template = await fs.readFile(path.join(__dirname, "site-template.html"), "utf8");
const dataScript =
  "<script>\nwindow.GAMES = " + JSON.stringify(slim) + ";\n" +
  "window.CLUBS = " + JSON.stringify(clubs) + ";\n</" + "script>";
const html = template.replace("<!--DATA-->", dataScript);

// Output to docs/ — GitHub Pages serves it directly from the main branch.
await fs.mkdir(path.join(ROOT, "docs"), { recursive: true });
await fs.writeFile(path.join(ROOT, "docs", "index.html"), html);
// Keep search engines out — the unlisted video links shouldn't be crawlable.
await fs.writeFile(path.join(ROOT, "docs", "robots.txt"), "User-agent: *\nDisallow: /\n");
// Remove the old external data file if it lingers from a previous build.
await fs.rm(path.join(ROOT, "docs", "games-data.js"), { force: true });

const withSheets = slim.filter((g) => g.sheetUrl).length;
console.log(`Wrote self-contained docs/index.html with ${slim.length} games.`);
console.log(`Scoresheet PDFs matched: ${withSheets} (from ${sheetCount} sheets in snapshot).`);
console.log("Clubs (by most recent game):");
for (const c of clubs) console.log(`  ${c.lastDate}  ${c.label} (${c.count})`);
