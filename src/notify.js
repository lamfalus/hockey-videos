// Post newly-added game videos to a Telegram channel.
//
//   node src/notify.js
//
// Config (either works; env wins):
//   env  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   file credentials/telegram.json  ->  { "botToken": "...", "chatId": "..." }
//
// State: data/announced.json holds the videoIds already posted. On the FIRST
// run it seeds with every current video and posts nothing, so the existing
// backlog is never blasted — only genuinely new uploads go out afterward.
//
// Unconfigured => it just prints a note and exits 0, so it's safe to leave in
// the pipeline before Telegram is set up.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; }
}

async function loadConfig() {
  const env = { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
  if (env.botToken && env.chatId) return env;
  const file = await readJson(path.join(ROOT, "credentials", "telegram.json"), null);
  if (file?.botToken && file?.chatId) return file;
  return null;
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

async function sendMessage(cfg, text) {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram error: ${json.error_code || res.status} ${json.description || ""}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = await loadConfig();
  if (!cfg) { console.log("notify: Telegram not configured (no token/chat) — skipping."); return; }

  const games = (await readJson(path.join(ROOT, "data", "site-games.json"), []))
    .filter((g) => g.videoId && g.teamA && g.teamB);
  const statePath = path.join(ROOT, "data", "announced.json");
  const prior = await readJson(statePath, null);

  // First run: seed with everything, announce nothing.
  if (prior === null) {
    const ids = games.map((g) => g.videoId);
    await fs.writeFile(statePath, JSON.stringify(ids, null, 0));
    console.log(`notify: seeded ${ids.length} existing videos (posted 0). New uploads will post from now on.`);
    return;
  }

  const announced = new Set(prior);
  const fresh = games
    .filter((g) => !announced.has(g.videoId))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")); // oldest first

  if (!fresh.length) { console.log("notify: no new videos."); return; }

  let posted = 0;
  for (const g of fresh) {
    try {
      await sendMessage(cfg, messageFor(g));
      announced.add(g.videoId);
      posted++;
      await sleep(1500); // stay well under channel rate limits
    } catch (e) {
      console.error(`notify: failed to post ${g.videoId} (${g.title}): ${e.message}`);
      // leave it un-announced so it retries next run
    }
  }
  await fs.writeFile(statePath, JSON.stringify([...announced], null, 0));
  console.log(`notify: posted ${posted} of ${fresh.length} new video(s).`);
}

main().catch((e) => { console.error("notify error:", e.message); process.exit(1); });
