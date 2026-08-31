// One-time authorization via an explicit OAuth loopback flow.
//   npm run auth
// Prints the Google consent URL, starts a local server to catch the redirect,
// exchanges the code, and saves credentials/token.json (authorized_user form).

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRED = path.join(__dirname, "..", "credentials");
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
const PORT = 5858;
const REDIRECT = `http://localhost:${PORT}`;

const keys = JSON.parse(await fs.readFile(path.join(CRED, "client_secret.json"), "utf8"));
const key = keys.installed || keys.web;
const oauth2 = new google.auth.OAuth2(key.client_id, key.client_secret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

await fs.writeFile(path.join(CRED, "auth_url.txt"), authUrl);
console.log("AUTH_URL:" + authUrl);
console.log("Waiting for consent redirect on " + REDIRECT + " …");

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, REDIRECT);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      if (err) {
        res.end("Authorization error: " + err);
        server.close();
        reject(new Error(err));
        return;
      }
      if (c) {
        res.setHeader("Content-Type", "text/html");
        res.end("<h2>✅ Authorized.</h2><p>You can close this tab and return to the terminal.</p>");
        server.close();
        resolve(c);
      } else {
        res.end("Waiting for authorization…");
      }
    } catch (e) {
      reject(e);
    }
  });
  server.listen(PORT);
  setTimeout(() => { server.close(); reject(new Error("Timed out waiting for consent")); }, 300000);
});

const { tokens } = await oauth2.getToken(code);
if (!tokens.refresh_token) {
  console.log("WARNING: no refresh_token returned (already granted before?). Revoke access and retry if sync fails.");
}
await fs.writeFile(
  path.join(CRED, "token.json"),
  JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: tokens.refresh_token,
  }, null, 2)
);
await fs.rm(path.join(CRED, "auth_url.txt"), { force: true });
console.log("SAVED token.json");
