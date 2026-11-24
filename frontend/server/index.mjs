/**
 * Vienovo Telecast multi-user server.
 *
 *  - serves the built app (dist/) and uploaded media (/uploads/...) with Range support
 *  - keeps ONE shared show state (server-data/state.json) and pushes it to everyone over WebSocket (/ws)
 *  - roles: one Director (controls the show), Editors (edit segments, upload media), Live screens (watch)
 *  - relays WebRTC signalling so the Director can stream a shared Teams / Meet / Zoom window to every screen
 *
 * Settings (environment variables):
 *   PORT            default 3010
 *   SHOW_CODE       access code for editors and live screens   (default "vienovo2026")
 *   DIRECTOR_CODE   access code for the director               (default "director2026")
 *   DATA_DIR        where state.json and uploads are kept      (default ./server-data)
 *   TURN_URL, TURN_USER, TURN_PASS   optional TURN relay for strict company networks
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +process.env.PORT || 3010;
const SHOW_CODE = process.env.SHOW_CODE || "vienovo2026";
const DIRECTOR_CODE = process.env.DIRECTOR_CODE || "director2026";
const DIST = path.join(ROOT, "dist");
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "server-data"));
const UPLOADS = path.join(DATA, "uploads");
const STATE_FILE = path.join(DATA, "state.json");
fs.mkdirSync(UPLOADS, { recursive: true });

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
if (process.env.TURN_URL)
  ICE.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });

/* ---------- shared state ---------- */
let S = null;
try {
  S = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
} catch {
  /* first run: the first director to connect seeds the state */
}
let saveT = 0;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = STATE_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(S), (e) => {
      if (!e) fs.rename(tmp, STATE_FILE, () => {});
    });
  }, 300);
}

/* ---------- http ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    // uploads and the show's media never change under the same name (every upload gets a new id), and the
    // built scripts have a hash in their name: browsers may keep them for good instead of downloading again
    const forever = file.startsWith(UPLOADS + path.sep) || /[\\/]assets[\\/](media[\\/]|[^\\/]+-[\w-]{8}\.(js|css)$)/.test(file);
    const cache = file.endsWith("index.html")
      ? "no-cache"
      : forever
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) {
      const a = m[1] ? +m[1] : Math.max(0, st.size - +m[2]),
        b = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (a > b) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": b - a + 1,
        "Content-Range": `bytes ${a}-${b}/${st.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cache,
      });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": cache,
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

/** resolve a URL path inside a base folder, refusing anything that escapes it */
function inside(base, p) {
  const f = path.join(base, decodeURIComponent(p));
  return f.startsWith(base + path.sep) ? f : null;
}

const okCode = (c) => c === SHOW_CODE || c === DIRECTOR_CODE;

function upload(req, res) {
  if (!okCode(req.headers["x-show-code"])) {
    res.writeHead(403).end("Wrong access code");
    return;
  }
  const name = decodeURIComponent(String(req.headers["x-file-name"] || "file"));
  let ext = path.extname(name).toLowerCase();
  if (!/^\.[a-z0-9]{1,5}$/.test(ext)) ext = "";
  const id = "u" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const file = path.join(UPLOADS, id + ext),
    out = fs.createWriteStream(file);
  let size = 0;
  req.on("data", (c) => (size += c.length));
  req.pipe(out);
  out.on("finish", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, url: "/uploads/" + id + ext, size }));
  });
  const fail = () => {
    out.destroy();
    fs.unlink(file, () => {});
    if (!res.headersSent) res.writeHead(500).end("Upload failed");
  };
  req.on("aborted", fail);
  out.on("error", fail);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"),
    p = u.pathname;
  if (p === "/api/info") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    // samePc: the browser runs on this computer (it can use http://localhost, where tab sharing is allowed)
    // (not through a tunnel or proxy: there every visitor seems to come from this computer)
    const proxied = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
    const samePc = !proxied && req.socket.remoteAddress === req.socket.localAddress;
    res.end(JSON.stringify({ ok: true, app: "vienovo-telecast", hasState: !!S, samePc }));
    return;
  }
  if (p === "/api/upload" && req.method === "POST") return upload(req, res);
  if (p.startsWith("/uploads/")) {
    const f = inside(UPLOADS, p.slice(9));
    return f ? serveFile(req, res, f) : res.writeHead(404).end();
  }
  const f = p === "/" ? path.join(DIST, "index.html") : inside(DIST, p.slice(1));
  if (!f) return res.writeHead(404).end();
  fs.stat(f, (e, st) => serveFile(req, res, !e && st.isFile() ? f : path.join(DIST, "index.html")));
});

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 50 * 1024 * 1024 });
const clients = new Map(); // ws -> { id, name, role }
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const users = () => [...clients.values()].filter((c) => c.role).map(({ id, name, role, loc }) => ({ id, name, role, loc }));
/**
 * Segments can belong to one location (seg.loc). An Editor may change only segments of their own location
 * and the shared ones (no loc), and may only give a segment to their own location or back to "all".
 */
const mayEdit = (me, seg) => me.role === "director" || !seg || !seg.loc || seg.loc === me.loc;
const everyone = (m, except) => {
  const j = JSON.stringify(m); // encode once, not once per person
  for (const ws of clients.keys()) if (ws !== except && clients.get(ws).role && ws.readyState === 1) ws.send(j);
};
const byId = (id) => [...clients].find(([, c]) => c.id === id)?.[0];
const director = () => [...clients].find(([, c]) => c.role === "director");

wss.on("connection", (ws) => {
  const me = { id: crypto.randomBytes(4).toString("hex"), name: "", role: "" };
  clients.set(ws, me);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === "hello") {
      const role = ["director", "editor", "screen"].includes(m.role) ? m.role : "screen";
      if (role === "director" ? m.code !== DIRECTOR_CODE : !okCode(m.code))
        return send(ws, { t: "denied", msg: "Wrong access code for this role." });
      const d = director();
      if (role === "director" && d && d[0] !== ws) {
        if (!m.takeover)
          return send(ws, { t: "denied", busy: true, msg: `${d[1].name} is already connected as Director.` });
        d[1].role = "editor";
        send(d[0], { t: "role", role: "editor", msg: `${m.name} took over as Director. You are now an Editor.` });
      }
      me.name = String(m.name || "Guest").slice(0, 40);
      me.role = role;
      me.loc = /^[a-z0-9-]{1,20}$/.test(m.loc || "") ? m.loc : "";
      send(ws, { t: "welcome", you: { id: me.id, name: me.name, role, loc: me.loc }, S, ice: ICE });
      everyone({ t: "users", users: users() });
      return;
    }
    if (!me.role) return;
    switch (m.t) {
      case "seed": // first ever director: their copy becomes the shared show
        if (me.role !== "director" || !m.S || S) return;
        S = m.S;
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "show": // director: everything except segments + library (those come as patches)
        if (me.role !== "director" || !m.S || !S) return;
        S = { ...m.S, segs: S.segs, lib: S.lib };
        delete S.sfx; // sound effects stay at the location that played them (also from a page not yet refreshed)
        delete S.sfxVol;
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "lib-del":
        // the Director may delete anything; Editors only sound effects (never used in a segment)
        if (me.role === "screen" || !S || !Array.isArray(m.ids)) return;
        S.lib = (S.lib || []).filter((x) => !m.ids.includes(x.id) || (me.role !== "director" && x.kind !== "sfx"));
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "seg": {
        // an editor (or director) changed one segment
        if (me.role === "screen" || !S || !m.seg) return;
        const i = S.segs.findIndex((g) => g.id === m.seg.id);
        if (i < 0) return;
        // another location's segment: refused, and the sender gets the real one back
        if (!mayEdit(me, S.segs[i]) || !mayEdit(me, m.seg)) return send(ws, { t: "state", S });
        S.segs[i] = { ...m.seg, editedBy: me.name, editedLoc: me.loc, editedAt: Date.now() };
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S }); // everyone, so the sender also sees "edited by"
        break;
      }
      case "seg-add": {
        // a new segment, inserted after segment `after` (null = at the top)
        if (me.role === "screen" || !S || !m.seg || typeof m.seg.id !== "string") return;
        if (S.segs.some((g) => g.id === m.seg.id)) return;
        const a = m.after == null ? -1 : S.segs.findIndex((g) => g.id === m.after),
          at = m.after == null ? 0 : a < 0 ? S.segs.length : a + 1;
        // a segment an Editor adds belongs to their location
        const loc = me.role === "director" ? m.seg.loc || "" : me.loc;
        S.segs.splice(at, 0, { ...m.seg, loc, editedBy: me.name, editedLoc: me.loc, editedAt: Date.now() });
        if (at <= (S.seg || 0)) S.seg = (S.seg || 0) + 1; // the segment on air keeps its place
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S });
        break;
      }
      case "seg-del": {
        if (me.role === "screen" || !S) return;
        const i = S.segs.findIndex((g) => g.id === m.id);
        // never the last segment, nor the one on air: send the state back so the sender gets it again
        if (i < 0 || S.segs.length <= 1 || (i === (S.seg || 0) && S.started) || !mayEdit(me, S.segs[i]))
          return send(ws, { t: "state", S });
        S.segs.splice(i, 1);
        if (i < (S.seg || 0)) S.seg--;
        S.seg = Math.min(S.seg || 0, S.segs.length - 1);
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S });
        break;
      }
      case "lib": // new library items (already uploaded to /uploads)
        if (me.role === "screen" || !S || !Array.isArray(m.items)) return;
        S.lib = S.lib || [];
        for (const it of m.items) {
          const old = S.lib.findIndex((x) => x.id === it.id);
          if (old >= 0) S.lib[old] = { ...S.lib[old], ...it };
          else S.lib.push(it);
        }
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "time": // clock sync: every location uses the server's time for countdowns
        send(ws, { t: "time", c: m.c, s: Date.now() });
        break;
      case "rtc-want": {
        // a screen wants the live call stream: ask the director to call it
        const d = director();
        if (d) send(d[0], { t: "rtc-want", from: me.id, name: me.name });
        break;
      }
      case "rtc": {
        const to = byId(m.to);
        if (to) send(to, { ...m, from: me.id });
        break;
      }
    }
  });
  ws.on("close", () => {
    const wasDir = me.role === "director";
    clients.delete(ws);
    everyone({ t: "users", users: users() });
    if (wasDir) everyone({ t: "director-left", name: me.name });
  });
});
setInterval(() => {
  for (const ws of clients.keys()) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`\n  Vienovo Telecast server running on http://localhost:${PORT}`);
  console.log(`  Editors / live screens code: ${SHOW_CODE}`);
  console.log(`  Director code:               ${DIRECTOR_CODE}`);
  console.log(`  Data folder: ${DATA}`);
  if (!fs.existsSync(DIST)) console.log("  (dist/ not built yet - run `npm run build`, or use `npm run dev` with this server)");
});
