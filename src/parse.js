// Parse a YouTube video title/description into structured game data.
//
// Dominant pattern observed on the channel:
//   "<Team A> vs <Team B>, <YYYY-MM-DD>[, game-N]"
// with the result in the description: "Win, 7-1" / "Tie, 3-3" / "OT Loss, 2-3".
//
// Real-world messiness this handles (all seen on the actual channel):
//   - date with spaces instead of dashes:  "... Eagles 2026 05 02"
//   - date with no comma before it:        "... scrimmage 2026-08-23"
//   - missing date entirely:               "Cougars 12-1 vs 12-2 Falcon"
//   - year typo:                           "..., 2028-08-23" (uploaded 2026)
//   - non-game clips (no "vs"):            "Alexander goals against"
//   - duplicate camera uploads:            one tagged "Pixellot"
//   - your team not always listed first
//
// Each parse carries a `confidence` and, when something looks off, a `flags`
// list so nothing is silently dropped — low-confidence rows go to review.

const GAME_RE = /\bgame[-\s]?(\d+)\b/i;
const RESULT_RE = /\b((?:OT |SO )?(?:Win|Loss|Tie))\b(?:[,\s]+(\d+)\s*-\s*(\d+))?/i;
const SCRIMMAGE_RE = /\bscrimmage\b/i;
// Known alternate camera / source tags that create duplicate uploads.
const SOURCE_RE = /\b(pixellot|gopro|iphone|livebarn)\b/i;

// How far the title's date may drift from the upload date before we flag it
// as a probable typo (e.g. the "2028" year mistake). Uploads can lag filming
// by a few days, so allow a generous window.
const MAX_DRIFT_DAYS = 45;

function pad(n) {
  return String(n).padStart(2, "0");
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normYear(y) {
  y = Number(y);
  return y < 100 ? 2000 + y : y; // "24" -> 2024
}

// Try several real-world date formats found in the titles. Returns
// { iso, raw, format } or null. `raw` is the exact matched substring so the
// team-name cleaner can strip it.
function extractDate(text) {
  let m;

  // 1) ISO-ish: YYYY-MM-DD or "YYYY MM DD" (also handles YYYY-DD-MM swap)
  m = text.match(/\b(20\d{2})[-\s.](\d{1,2})[-\s.](\d{1,2})\b/);
  if (m) {
    let mo = Number(m[2]), d = Number(m[3]);
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // "2025-27-09" -> YYYY-DD-MM
    const iso = toIsoDate(m[1], mo, d);
    if (iso) return { iso, raw: m[0], format: /-/.test(m[0]) ? "iso" : "iso-spaces" };
  }

  // 2) D-Mon-YYYY / D Mon YY  e.g. "3-May-24", "20-Apr-2024"
  m = text.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s.](20\d{2}|\d{2})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const iso = toIsoDate(normYear(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
    if (iso) return { iso, raw: m[0], format: "d-mon-y" };
  }

  // 3) Mon-D-YYYY  e.g. "May 3 2024", "Apr 20, 2024"
  m = text.match(/\b([A-Za-z]{3,9})[-\s](\d{1,2})[,\s]+(20\d{2}|\d{2})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const iso = toIsoDate(normYear(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
    if (iso) return { iso, raw: m[0], format: "mon-d-y" };
  }

  // 4) US numeric M-D-YY or M-D-YYYY  e.g. "9-8-24", "8-31-2024", "9/1/2024"
  //    Requires a 3rd year group, so team codes like "12-1" won't match.
  m = text.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2}|\d{2})\b/);
  if (m) {
    const iso = toIsoDate(normYear(m[3]), m[1], m[2]);
    if (iso) return { iso, raw: m[0], format: "m-d-y" };
  }

  return null;
}

// Validate and normalize a (year, month, day) to an ISO date string, or null.
function toIsoDate(y, m, d) {
  y = Number(y);
  m = Number(m);
  d = Number(d);
  if (y < 2010 || y > 2035) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. Feb 30
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z").getTime();
  const b = new Date(isoB + "T00:00:00Z").getTime();
  return Math.abs(a - b) / 86400000;
}

// Strip trailing date / game / source noise from a team-name fragment.
// `dateRaw` is the exact date substring that matched (if any), removed verbatim.
function cleanTeam(fragment, dateRaw) {
  let s = fragment;
  if (dateRaw) s = s.split(dateRaw).join(" ");
  return s
    .replace(GAME_RE, " ")
    .replace(SCRIMMAGE_RE, " ")
    .replace(SOURCE_RE, " ")
    .replace(/[,\-–—]+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * @param {{title:string, description?:string, uploadDate?:string, videoId?:string}} video
 *   uploadDate is an ISO date (YYYY-MM-DD) derived from publishedAt.
 * @returns {object} structured game record with confidence + flags.
 */
export function parseVideo(video) {
  const title = (video.title || "").trim();
  const description = (video.description || "").trim();
  const uploadDate = video.uploadDate || null;

  const flags = [];
  const rec = {
    videoId: video.videoId || null,
    title,
    url: video.videoId ? `https://youtu.be/${video.videoId}` : null,
    isGame: false,
    teamA: null,
    teamB: null,
    date: null,
    dateSource: null, // "title" | "upload"
    dateFormat: null, // which title format matched
    gameNum: null,
    isScrimmage: SCRIMMAGE_RE.test(title),
    source: null, // e.g. "Pixellot" when a duplicate camera upload
    result: null, // { outcome, for, against } from description
    confidence: "low",
    flags,
    uploadDate,
  };

  // --- Split on "vs" -------------------------------------------------------
  const vsMatch = title.match(/\s+vs\.?\s+/i);
  if (!vsMatch) {
    flags.push("no-vs"); // highlight clip or non-game upload
    return rec;
  }
  rec.isGame = true;
  const idx = vsMatch.index;
  const leftRaw = title.slice(0, idx);
  const rightRaw = title.slice(idx + vsMatch[0].length);

  // --- Date ----------------------------------------------------------------
  const dateInfo = extractDate(title);
  if (dateInfo) {
    rec.date = dateInfo.iso;
    rec.dateSource = "title";
    rec.dateFormat = dateInfo.format;
    if (dateInfo.format === "iso-spaces") flags.push("date-spaces"); // "2026 05 02"
    if (uploadDate && daysBetween(dateInfo.iso, uploadDate) > MAX_DRIFT_DAYS) {
      flags.push("date-drift"); // probable year typo, e.g. 2028
    }
  }
  if (!rec.date && uploadDate) {
    rec.date = uploadDate; // fall back to when it was uploaded
    rec.dateSource = "upload";
    flags.push("date-missing");
  }

  // --- Game number & source tag -------------------------------------------
  const gameMatch = title.match(GAME_RE);
  if (gameMatch) rec.gameNum = Number(gameMatch[1]);
  const srcMatch = title.match(SOURCE_RE);
  if (srcMatch) rec.source = srcMatch[1][0].toUpperCase() + srcMatch[1].slice(1).toLowerCase();

  // --- Teams ---------------------------------------------------------------
  rec.teamA = cleanTeam(leftRaw, dateInfo?.raw);
  rec.teamB = cleanTeam(rightRaw, dateInfo?.raw);
  if (!rec.teamA || !rec.teamB) flags.push("team-missing");

  // --- Result (from description) ------------------------------------------
  const resMatch = description.match(RESULT_RE);
  if (resMatch) {
    rec.result = {
      outcome: resMatch[1].replace(/\s+/g, " ").trim(),
      for: resMatch[2] != null ? Number(resMatch[2]) : null,
      against: resMatch[3] != null ? Number(resMatch[3]) : null,
    };
  }

  // --- Confidence ----------------------------------------------------------
  const hardFlags = flags.filter((f) => f !== "date-spaces"); // spaces = cosmetic
  if (rec.teamA && rec.teamB && rec.date && rec.dateSource === "title" && hardFlags.length === 0) {
    rec.confidence = "high";
  } else if (rec.teamA && rec.teamB && rec.date) {
    rec.confidence = "medium";
  } else {
    rec.confidence = "low";
  }
  return rec;
}

// --- Demo: run the parser over the sample titles captured from the channel ---
const DEMO = [
  ["Cougars 12-1 vs SCBH 12-1, 2026-08-30", "Cougars 12-1 vs SCBH 12-1, 2026-08-30 Win, 7-1", "2026-08-30"],
  ["Jr. Sharks 14AAA vs Jr. Kraken, 2026-08-30, game-1", "... game-1 Tie, 3-3", "2026-08-30"],
  ["Jr. Sharks 14AAA vs Jr. Kraken, 2026-08-30, game-2", "... game-2 OT Loss, 2-3", "2026-08-30"],
  ["Cougars 12-1 vs 12-2 Falcon", "Add description", "2026-08-23"],
  ["Cougars 12-1 vs Cougars 12-2 scrimmage 2026-08-23", "", "2026-08-23"],
  ["Jr. Sharks 14AAA vs Jr. Reign 14AA, 2028-08-23", "... Win, 5-2", "2026-08-23"],
  ["Cougars 12-1 vs Jr. Sharks 12-2, 2026-08-22", "... Win, 6-4 Pixellot", "2026-08-22"],
  ["Fox Cities Bulldogs vs Bay Area Eagles 2026 05 02", "", "2026-05-03"],
  ["GSE 12-1 vs SC Blackhawks, 9-8-2024", "", "2024-09-09"],
  ["GSE 16-1 vs Arctic Lions, 8-24-24", "", "2024-08-25"],
  ["'15 Blazers vs Snipers, 3-May-24", "", "2024-05-04"],
  ["GSE Spring VS SDP 2012 SELECTS, 20-Apr-2024", "", "2024-04-21"],
  ["GSE 18AA vs Capital Flames, 2025-27-09", "", "2025-09-28"],
  ["Alexander goals against", "Add description", "2026-04-07"],
];

if (process.argv.includes("--demo")) {
  for (const [title, description, uploadDate] of DEMO) {
    const r = parseVideo({ title, description, uploadDate, videoId: "DEMOxxxx" });
    console.log("―".repeat(60));
    console.log("TITLE :", title);
    console.log(
      `  → ${r.confidence.toUpperCase().padEnd(6)} ` +
        (r.isGame ? `${r.teamA}  vs  ${r.teamB}` : "(not a game)")
    );
    console.log(
      `    date=${r.date}(${r.dateSource})` +
        (r.gameNum ? ` game=${r.gameNum}` : "") +
        (r.isScrimmage ? " scrimmage" : "") +
        (r.source ? ` src=${r.source}` : "") +
        (r.result ? ` result=${r.result.outcome} ${r.result.for}-${r.result.against}` : "")
    );
    if (r.flags.length) console.log(`    flags: ${r.flags.join(", ")}`);
  }
  console.log("―".repeat(60));
}
