// YouTube OAuth + upload fetching.
//
// We use OAuth (not just an API key) because the game videos are Unlisted —
// only the authenticated channel owner can list them. Scope is read-only.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CRED_DIR = path.join(ROOT, "credentials");
const CLIENT_SECRET_PATH = path.join(CRED_DIR, "client_secret.json");
const TOKEN_PATH = path.join(CRED_DIR, "token.json");

const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

async function loadSavedToken() {
  try {
    const content = await fs.readFile(TOKEN_PATH, "utf8");
    return google.auth.fromJSON(JSON.parse(content));
  } catch {
    return null;
  }
}

async function saveToken(client) {
  const keys = JSON.parse(await fs.readFile(CLIENT_SECRET_PATH, "utf8"));
  const key = keys.installed || keys.web;
  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    }, null, 2)
  );
}

/** Get an authorized client, running the one-time browser consent if needed. */
export async function authorize() {
  const saved = await loadSavedToken();
  if (saved) return saved;

  try {
    await fs.access(CLIENT_SECRET_PATH);
  } catch {
    throw new Error(
      `Missing ${CLIENT_SECRET_PATH}\n` +
        `Download your OAuth client (Desktop app) from Google Cloud Console and save it there.`
    );
  }

  const client = await authenticate({ scopes: SCOPES, keyfilePath: CLIENT_SECRET_PATH });
  if (client.credentials.refresh_token) await saveToken(client);
  return client;
}

/** Fetch every upload on the authenticated channel (includes Unlisted). */
export async function fetchAllUploads(auth, { onProgress } = {}) {
  const youtube = google.youtube({ version: "v3", auth });

  const chan = await youtube.channels.list({ part: ["contentDetails"], mine: true });
  const uploadsPlaylist =
    chan.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) throw new Error("Could not find the channel's uploads playlist.");

  const videos = [];
  let pageToken;
  do {
    const res = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId: uploadsPlaylist,
      maxResults: 50,
      pageToken,
    });
    for (const item of res.data.items ?? []) {
      const publishedAt =
        item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null;
      videos.push({
        videoId: item.contentDetails?.videoId,
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        publishedAt,
        uploadDate: publishedAt ? publishedAt.slice(0, 10) : null,
      });
    }
    pageToken = res.data.nextPageToken;
    if (onProgress) onProgress(videos.length);
  } while (pageToken);

  return videos;
}
