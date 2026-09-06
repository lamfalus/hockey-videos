// Post newly-added game videos to per-team Telegram channels.
//
//   node src/notify.js
//
// Config: credentials/telegram.json (kept out of git). One bot, many channels,
// each with its own filter:
//   {
//     "botToken": "123:ABC",
//     "channels": [
//       { "chatId": "-1004490810022", "name": "Cougars 12-1", "team": "Cougars 12-1" },
//       { "chatId": "-100...",        "name": "Jr Sharks 13AAA", "team": "Jr. Sharks 13AAA" },
//       { "chatId": "-100...",        "name": "All Cougars",    "club": "cougars" },
//       { "chatId": "-100...",        "name": "Everything",     "all": true }
//     ]
//   }
// Filter per channel (pick one): "team" (a game matches if either side's name
// contains all the filter's words — "Cougars 12-1" matches "Cougars 12-1" but
// not "Cougars 12-2"/"Cougars 10U-1"), "club" (a club id: cougars/gse/sharks/
// blazers/delta), or "all". Legacy flat { botToken, chatId } (or the env vars
// TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) is treated as one "all" channel.
//
// State: data/announced.json = { "<chatId>": [videoIds] }, per channel. The
// first run for a channel seeds it with every current video (posts nothing), so
// existing games never blast — only new uploads matching that channel go out.
//
// Unconfigured => prints a note and exits 0.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; }
}

async function loadConfig() {
  const file = await readJson(path.join(ROOT, "credentials", "telegram.json"), null);
  let token = process.env.TELEGRAM_BOT_TOKEN || file?.botToken;
  if (!token) return null;
  let channels = file?.channels;
  if (!channels) {
    const chatId = process.env.TELEGRAM_CHAT_ID || file?.chatId;
    if (!chatId) return null;
    channels = [{ chatId, name: "all", all: true }]; // legacy / env => one "all" channel
  }
  return { token, channels };
}

const tokset = (s) => new Set((s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const isSuperset = (a, b) => { for (const t of b) if (!a.has(t)) return false; return true; };

function matcherFor(ch) {
  if (ch.all) return () => true;
  if (ch.club) { const c = String(ch.club).toLowerCase(); return (g) => (g.clubs || []).includes(c); }
  // `team` (one spelling) or `teamAny` (several) — a game matches when either
  // side's word-set contains ALL the words of ANY listed spelling.
  const spellings = ch.teamAny || (ch.team ? [ch.team] : null);
  if (spellings) {
    const wants = spellings.map(tokset);
    return (g) => {
      const A = tokset(g.teamA), B = tokset(g.teamB);
      return wants.some((w) => isSuperset(A, w) || isSuperset(B, w));
    };
  }
  return () => true;
}

function esc(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function messageFor(g) {
  const [y, m, d] = (g.date || "----01-01").split("-").map(Number);
  const when = `${MON[(m || 1) - 1]} ${d || "?"}, ${y || ""}`;
  let text = `🏒 <b>${when} · ${esc(g.teamA)} vs ${esc(g.teamB)}</b>`;
  if (g.result?.outcome) {
    const score = g.result.for != null && g.result.against != null ? ` ${g.result.for}-${g.result.against}` : "";
    text += `\n${esc(g.result.outcome)}${score}`;
  }
  text += `\n▶️ ${g.url}`;
  if (g.sheetUrl) text += `\n📄 Scoresheet: ${g.sheetUrl}`;
  return text;
}

async function sendMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${json.error_code || res.status}: ${json.description || ""}`);
  return json;
}

async function main() {
  const cfg = await loadConfig();
  if (!cfg) { console.log("notify: Telegram not configured — skipping."); return; }

  const games = (await readJson(path.join(ROOT, "data", "site-games.json"), []))
    .filter((g) => g.videoId && g.teamA && g.teamB);
  const allIds = games.map((g) => g.videoId);
  const statePath = path.join(ROOT, "data", "announced.json");
  let state = await readJson(statePath, {});
  if (Array.isArray(state)) state = {}; // migrate away from the old flat array

  for (const ch of cfg.channels) {
    const key = String(ch.chatId);
    const label = ch.name || key;
    if (!state[key]) {
      state[key] = allIds.slice();
      console.log(`notify[${label}]: seeded ${allIds.length} existing videos (posted 0).`);
      continue;
    }
    const seen = new Set(state[key]);
    const match = matcherFor(ch);
    const fresh = games
      .filter((g) => !seen.has(g.videoId) && match(g))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    // Anything new but not matching this channel: mark seen so it isn't reconsidered.
    for (const g of games) if (!seen.has(g.videoId) && !match(g)) seen.add(g.videoId);

    let posted = 0;
    for (const g of fresh) {
      try {
        await sendMessage(cfg.token, ch.chatId, messageFor(g));
        seen.add(g.videoId);
        posted++;
        await sleep(1500);
      } catch (e) {
        console.error(`notify[${label}]: failed ${g.videoId} (${g.title}): ${e.message}`);
      }
    }
    state[key] = [...seen];
    console.log(`notify[${label}]: posted ${posted} of ${fresh.length} new matching video(s).`);
  }

  await fs.writeFile(statePath, JSON.stringify(state, null, 0));
}

main().catch((e) => { console.error("notify error:", e.message); process.exit(1); });
