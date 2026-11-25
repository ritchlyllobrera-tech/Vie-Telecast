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
 *   SHOW_CODE       access code for editors and live screens   (REQUIRED, min 8 chars)
 *   DIRECTOR_CODE   access code for the director               (REQUIRED, min 8 chars, different from SHOW_CODE)
 *   DATA_DIR        where state.json and uploads are kept      (default ./server-data)
 *   MAX_UPLOAD_MB   largest single upload                      (default 2048)
 * These can also be put in frontend/.env (real environment variables take precedence).
 *   TURN_URL, TURN_USER, TURN_PASS   optional TURN relay for strict company networks
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** tiny .env reader (KEY=VALUE, # comments, optional quotes). Real environment variables win over the file. */
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v) && v.length >= 2) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ""); // trailing comment on an unquoted value
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {
  /* no .env file: fine */
}

const PORT = +process.env.PORT || 3010;
const SHOW_CODE = process.env.SHOW_CODE || "";
const DIRECTOR_CODE = process.env.DIRECTOR_CODE || "";
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB > 0 ? +process.env.MAX_UPLOAD_MB : 2048) * 1024 * 1024;
{
  // there are no built-in codes: the server refuses to start without its own, strong enough ones
  const bad = [];
  if (!SHOW_CODE) bad.push("SHOW_CODE is not set");
  else if (SHOW_CODE.length < 8) bad.push("SHOW_CODE is shorter than 8 characters");
  if (!DIRECTOR_CODE) bad.push("DIRECTOR_CODE is not set");
  else if (DIRECTOR_CODE.length < 8) bad.push("DIRECTOR_CODE is shorter than 8 characters");
  if (SHOW_CODE && SHOW_CODE === DIRECTOR_CODE) bad.push("SHOW_CODE and DIRECTOR_CODE must be different");
  if (bad.length) {
    console.error(
      "\n  Vienovo Telecast server NOT started:\n" +
        bad.map((b) => "   - " + b).join("\n") +
        "\n\n  Set both access codes (at least 8 characters, different from each other), either in frontend/.env\n" +
        "  (two lines: SHOW_CODE=... and DIRECTOR_CODE=...) or as environment variables, e.g.\n" +
        "    cmd:         set SHOW_CODE=... && set DIRECTOR_CODE=... && npm run server\n" +
        '    PowerShell:  $env:SHOW_CODE="..."; $env:DIRECTOR_CODE="..."; npm run server\n',
    );
    process.exit(1);
  }
}
const DIST = path.join(ROOT, "dist");
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "server-data"));
const UPLOADS = path.join(DATA, "uploads");
const STATE_FILE = path.join(DATA, "state.json");
fs.mkdirSync(UPLOADS, { recursive: true });

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
if (process.env.TURN_URL)
  ICE.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });

// event-day resilience: log the problem and keep serving instead of dying
process.on("uncaughtException", (e) => console.error("uncaughtException:", e && e.stack ? e.stack : e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.stack ? e.stack : e));

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

/** resolve an (already decoded) URL path inside a base folder, refusing anything that escapes it */
function inside(base, p) {
  if (p.includes("\0")) return null;
  const f = path.join(base, p);
  return f.startsWith(base + path.sep) ? f : null;
}

const okCode = (c) => c === SHOW_CODE || c === DIRECTOR_CODE;

/* ---------- brute-force limit for access codes (per client IP, memory bounded) ---------- */
const FAIL_MAX = 10,
  FAIL_WINDOW = 5 * 60 * 1000,
  FAIL_IPS = 5000;
const fails = new Map(); // ip -> { n, t } (t = start of the window)
/** the visitor's IP; proxy headers are trusted only when the proxy (tunnel) itself is on this computer */
function clientIp(req) {
  const a = req.socket.remoteAddress || "?";
  if (a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1") {
    const h = req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (h) return String(h).slice(0, 64);
  }
  return a;
}
const lockedOut = (ip) => {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.t > FAIL_WINDOW) {
    fails.delete(ip);
    return false;
  }
  return f.n >= FAIL_MAX;
};
const noteFail = (ip) => {
  const now = Date.now(),
    f = fails.get(ip);
  if (f && now - f.t <= FAIL_WINDOW) f.n++;
  else {
    if (fails.size >= FAIL_IPS) for (const [k, v] of fails) if (now - v.t > FAIL_WINDOW || fails.size >= FAIL_IPS) fails.delete(k);
    fails.set(ip, { n: 1, t: now });
  }
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (now - v.t > FAIL_WINDOW) fails.delete(k);
}, 60000).unref();

function upload(req, res) {
  const ip = clientIp(req);
  if (lockedOut(ip)) {
    res.writeHead(429).end("Too many wrong codes. Try again in a few minutes.");
    return;
  }
  if (!okCode(req.headers["x-show-code"])) {
    noteFail(ip);
    res.writeHead(403).end("Wrong access code");
    return;
  }
  if (+req.headers["content-length"] > MAX_UPLOAD) {
    res.writeHead(413, { Connection: "close" }).end("File too large (limit " + Math.round(MAX_UPLOAD / 1048576) + " MB)");
    return;
  }
  let name = "file";
  try {
    name = decodeURIComponent(String(req.headers["x-file-name"] || "file"));
  } catch {
    /* malformed name: the extension is simply dropped */
  }
  let ext = path.extname(name).toLowerCase();
  if (!/^\.[a-z0-9]{1,5}$/.test(ext)) ext = "";
  const id = "u" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const file = path.join(UPLOADS, id + ext),
    out = fs.createWriteStream(file);
  let size = 0,
    dead = false;
  const fail = (code = 500, msg = "Upload failed") => {
    if (dead) return;
    dead = true;
    req.unpipe(out);
    out.destroy();
    fs.unlink(file, () => {});
    if (!res.headersSent) res.writeHead(code, { Connection: "close" }).end(msg);
    if (code === 413) res.once("finish", () => req.destroy()); // stop reading the rest once the answer is out
  };
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) fail(413, "File too large (limit " + Math.round(MAX_UPLOAD / 1048576) + " MB)");
  });
  req.pipe(out);
  out.on("finish", () => {
    if (dead) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, url: "/uploads/" + id + ext, size }));
  });
  req.on("aborted", () => fail());
  out.on("error", () => fail());
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    console.error("http handler error:", e && e.message);
    try {
      if (!res.headersSent) res.writeHead(500).end("Server error");
      else res.destroy();
    } catch {
      /* socket already gone */
    }
  }
});
server.on("clientError", (_e, sock) => sock.destroy());

function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  let p, dp;
  try {
    p = new URL(req.url, "http://x").pathname;
    dp = decodeURIComponent(p);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
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
  if (dp.startsWith("/uploads/")) {
    const f = inside(UPLOADS, dp.slice(9));
    if (!f) return res.writeHead(404).end();
    // uploaded files are user content on this origin: never let the browser run them as a page (SVG scripts etc.)
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return serveFile(req, res, f);
  }
  const f = dp === "/" ? path.join(DIST, "index.html") : inside(DIST, dp.slice(1));
  if (!f) return res.writeHead(404).end();
  fs.stat(f, (e, st) => serveFile(req, res, !e && st.isFile() ? f : path.join(DIST, "index.html")));
}

/* ---------- input checks (everything a client sends ends up in every screen's markup) ---------- */
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const ID_RE = /^[\w-]{1,64}$/;
const str = (x, max) => (typeof x === "string" ? x.slice(0, max) : "");
const KINDS = ["aud", "vid", "img", "sfx"];
const PLATS = ["teams", "meet", "zoom", "other", "youtube"];
const idList = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && ID_RE.test(x)).slice(0, 500) : []);
/** a segment from a client: known fields are type-checked, other fields are kept only when they are plain values */
const SEG_KEYS = ["id", "title", "desc", "time", "min", "loc", "yt", "av", "am", "an", "all", "loop", "wheel", "endAct", "aud", "vid", "img", "bg", "call", "editedBy", "editedLoc", "editedAt"];
/** Director-only fields: "📡 All sites", the meeting link (live call) and the YouTube Live link. Anyone else keeps the segment's current value */
const DIR_ONLY = ["all", "call", "yt"];
function keepAll(me, seg, old) {
  if (me.role === "director") return;
  for (const k of DIR_ONLY) {
    if (old && old[k] !== undefined) seg[k] = old[k];
    else delete seg[k];
  }
}
/** show-wide content from an Editor (ticker, awards, raffle list): only these keys, type-checked */
const MEDALS = ["", "gold", "silver", "bronze"];
function cleanShared(x) {
  const o = {};
  for (const k of ["ticker", "prize", "defBg", "rafMusic", "rafName"]) if (typeof x[k] === "string") o[k] = str(x[k], 2000);
  if (typeof x.pool === "string") o.pool = str(x.pool, 500000);
  if (Array.isArray(x.awards))
    o.awards = x.awards
      .filter(isObj)
      .slice(0, 3000)
      .map((a) => ({ name: str(a.name, 200), award: str(a.award, 200), medal: MEDALS.includes(a.medal) ? a.medal : "" }));
  if (Array.isArray(x.awFolders))
    o.awFolders = x.awFolders
      .filter((f) => typeof f === "string" && f)
      .slice(0, 500)
      .map((f) => f.slice(0, 120));
  if (isObj(x.awTitle)) {
    o.awTitle = {};
    for (const [k, v] of Object.entries(x.awTitle).slice(0, 500))
      if (k !== "__proto__" && typeof v === "string") o.awTitle[k.slice(0, 120)] = v.slice(0, 120);
  }
  if (isObj(x.awLoc)) {
    o.awLoc = {};
    for (const [k, v] of Object.entries(x.awLoc).slice(0, 500))
      if (k !== "__proto__" && typeof v === "string" && /^[a-z]{1,20}$/.test(v)) o.awLoc[k.slice(0, 120)] = v;
  }
  if (Array.isArray(x.winners))
    o.winners = x.winners
      .filter(isObj)
      .slice(0, 3000)
      .map((w) => ({ name: str(w.name, 200), prize: str(w.prize, 500) }));
  return o;
}
function cleanSeg(x) {
  if (!isObj(x) || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
  const g = {};
  let extra = 0;
  for (const [k, v] of Object.entries(x)) {
    if (k === "__proto__" || !/^[\w-]{1,40}$/.test(k)) continue;
    if (!(v === null || typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && v.length <= 2000))) continue;
    if (!SEG_KEYS.includes(k) && ++extra > 30) continue; // unknown fields: at most 30 per segment
    g[k] = v;
  }
  g.id = x.id;
  g.title = str(x.title, 200);
  g.desc = str(x.desc, 2000);
  g.time = typeof x.time === "string" && /^\d{1,2}:\d{2}$/.test(x.time) ? x.time : "";
  g.min = Number.isFinite(+x.min) ? Math.min(600, Math.max(0, +x.min)) : 0;
  g.loc = typeof x.loc === "string" && /^[a-z0-9-]{1,20}$/.test(x.loc) ? x.loc : "";
  g.yt = str(x.yt, 300);
  for (const k of ["av", "am", "an", "all", "loop", "wheel"]) if (k in x) g[k] = !!x[k];
  if ("endAct" in x) g.endAct = x.endAct === "next" ? "next" : "ask";
  for (const k of ["aud", "vid", "img"]) g[k] = idList(x[k]);
  if ("bg" in x) g.bg = typeof x.bg === "string" && ID_RE.test(x.bg) ? x.bg : null;
  if ("call" in x) {
    const c = isObj(x.call) ? x.call : {};
    g.call = { platform: PLATS.includes(c.platform) ? c.platform : "teams", link: str(c.link, 500) };
  }
  return g;
}
/** a library item from a client */
function cleanLib(x) {
  if (!isObj(x) || typeof x.id !== "string" || !ID_RE.test(x.id) || !KINDS.includes(x.kind)) return null;
  const it = { id: x.id, kind: x.kind, name: str(x.name, 200), size: Number.isFinite(+x.size) ? Math.max(0, +x.size) : 0 };
  if (x.url) {
    // only files this server hands out; no "//host", no "..", no schemes
    if (typeof x.url !== "string" || x.url.length > 300 || !/^\/(uploads|assets)\/[\w./-]+$/.test(x.url) || x.url.includes("..")) return null;
    it.url = x.url;
  }
  return it;
}

/* ---------- websocket ---------- */
const MAX_MSG = 8 * 1024 * 1024; // the whole show state is ~10 KB; media goes through /api/upload, not the socket
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MSG });
wss.on("error", (e) => console.error("ws server error:", e && e.message));
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

wss.on("connection", (ws, req) => {
  const me = { id: crypto.randomBytes(4).toString("hex"), name: "", role: "" };
  const ip = clientIp(req);
  clients.set(ws, me);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("error", () => {});
  ws.on("message", (raw, isBinary) => {
    try {
      let m;
      if (isBinary) return;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isObj(m) && typeof m.t === "string") onMessage(m);
    } catch (e) {
      console.error("ws message error:", e && e.message); // one bad message never takes the show down
    }
  });
  function onMessage(m) {
    if (m.t === "hello") {
      const role = ["director", "editor", "screen"].includes(m.role) ? m.role : "screen";
      if (lockedOut(ip))
        return send(ws, { t: "denied", msg: "Too many wrong codes from this computer. Wait 5 minutes and try again." });
      if (role === "director" ? m.code !== DIRECTOR_CODE : !okCode(m.code)) {
        noteFail(ip);
        return send(ws, { t: "denied", msg: "Wrong access code for this role." });
      }
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
        if (me.role !== "director" || !isObj(m.S) || S) return;
        S = m.S;
        if (Array.isArray(S.segs)) S.segs = S.segs.slice(0, 200).map(cleanSeg).filter(Boolean);
        if (Array.isArray(S.lib)) S.lib = S.lib.slice(0, 2000).map(cleanLib).filter(Boolean);
        if (!Array.isArray(S.segs) || !S.segs.length) {
          S = null; // not a usable show
          return;
        }
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "shared": // an Editor changed the ticker, awards or raffle list (their own flow stays on their computer)
        if (me.role !== "editor" || !isObj(m.S) || !S) return;
        S = { ...S, ...cleanShared(m.S) };
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S }, ws);
        break;
      case "show": // director: everything except segments + library (those come as patches)
        if (me.role !== "director" || !isObj(m.S) || !S) return;
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
        const seg = me.role === "screen" || !S ? null : cleanSeg(m.seg);
        if (!seg) return;
        const i = S.segs.findIndex((g) => g.id === seg.id);
        if (i < 0) return;
        // another location's segment: refused, and the sender gets the real one back
        if (!mayEdit(me, S.segs[i]) || !mayEdit(me, seg)) return send(ws, { t: "state", S });
        keepAll(me, seg, S.segs[i]);
        S.segs[i] = { ...seg, editedBy: me.name, editedLoc: me.loc, editedAt: Date.now() };
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S }); // everyone, so the sender also sees "edited by"
        break;
      }
      case "seg-add": {
        // a new segment, inserted after segment `after` (null = at the top)
        const ns = me.role === "screen" || !S ? null : cleanSeg(m.seg);
        if (!ns || S.segs.length >= 200) return;
        if (S.segs.some((g) => g.id === ns.id)) return;
        keepAll(me, ns, null);
        const a = m.after == null ? -1 : S.segs.findIndex((g) => g.id === m.after),
          at = m.after == null ? 0 : a < 0 ? S.segs.length : a + 1;
        // a segment an Editor adds belongs to their location
        const loc = me.role === "director" ? ns.loc || "" : me.loc;
        S.segs.splice(at, 0, { ...ns, loc, editedBy: me.name, editedLoc: me.loc, editedAt: Date.now() });
        if (at <= (S.seg || 0)) S.seg = (S.seg || 0) + 1; // the segment on air keeps its place
        S.savedAt = Date.now();
        persist();
        everyone({ t: "state", S });
        break;
      }
      case "seg-order": {
        // segments dragged to a new order: a permutation of the same ids. An Editor may not change the relative order of
        // segments of other locations (only move their own); the segment on air keeps being on air.
        if (me.role === "screen" || !S || !Array.isArray(m.ids) || m.ids.length > 1000) return;
        const cur = S.segs.map((g) => g.id),
          byId = new Map(S.segs.map((g) => [g.id, g]));
        const locked = (ids) => ids.filter((id) => !mayEdit(me, byId.get(id))),
          sameSeq = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
        const ok =
          m.ids.length === cur.length &&
          m.ids.every((id) => typeof id === "string" && byId.has(id)) &&
          new Set(m.ids).size === cur.length &&
          sameSeq(locked(m.ids), locked(cur));
        if (!ok) return send(ws, { t: "state", S });
        const onAir = (S.segs[S.seg || 0] || {}).id;
        S.segs = m.ids.map((id) => byId.get(id));
        S.seg = Math.max(0, S.segs.findIndex((g) => g.id === onAir));
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
        for (const raw of m.items.slice(0, 200)) {
          const it = cleanLib(raw);
          if (!it) continue; // bad id / kind / url: refused
          const old = S.lib.findIndex((x) => x.id === it.id);
          if (old >= 0) S.lib[old] = { ...S.lib[old], ...it };
          else if (S.lib.length < 2000) S.lib.push(it);
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
  }
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
  console.log("  Access codes: set (SHOW_CODE, DIRECTOR_CODE)");
  console.log(`  Data folder: ${DATA}`);
  if (!fs.existsSync(DIST)) console.log("  (dist/ not built yet - run `npm run build`, or use `npm run dev` with this server)");
});
