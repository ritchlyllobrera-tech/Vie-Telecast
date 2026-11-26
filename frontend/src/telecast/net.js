/**
 * Multi-user mode: connects to the Telecast server (server/index.mjs) when one is running.
 *
 *   Director  - runs the show (Start/Pause, takes segments live, shares the CEO call). Only one at a time.
 *   Editor    - edits segments and uploads media; can run the flow (Start, segments, music, effects) on
 *               their own computer as a private preview, but cannot change what is on air.
 *   Screen    - a live screen at a location; just shows the program.
 *
 * Without a server (or after "Work offline") the app behaves exactly as before, on one computer.
 *
 * Changes travel as small patches so people editing different segments never overwrite each other:
 *   show  - everything except segments and the library (director only)
 *   seg   - one changed segment
 *   lib / lib-del - library items added/updated, removed (removal: director only)
 */
import BUNDLED from "../data/mediaManifest.json";
import { DEF, LOCS, esc } from "./constants.js";
import { askTime, onTime, resetClock } from "./clock.js";
import { S, setS, fixSegs } from "./state.js";
import { LIVE, flush, pending } from "./sync.js";
import { render } from "./render.js";
import { holdOnOpen } from "./actions.js";
import { tx, autoSaveMedia } from "./media.js";
import { onRtc, onCallState, onDirectorLeft, stopLocalCall } from "./call.js";

const CK = "vtc_user";
// per-computer settings, never shared. Sound effects too: only the location that presses one hears it
// (that computer and its own pop-out Live Screen), never the other venues.
const LOCAL = ["edit", "monSound", "monVid", "sfx", "sfxVol"];
// what is playing / on screen (and the snow effect: each location keeps its own). An Editor runs their own flow with these on their own computer;
// only the Director's copy is the program that the Live screens show.
const PLAY = ["yt", "ytStop", "cmd", "running", "started", "seg", "segStart", "pausedLeft", "t0", "hold", "auto", "autoTime", "scene", "bgId", "spot", "spotTs", "spotList", "raffle", "rafLoc", "snow", "sfx", "sfxVol"];
// show-wide content an Editor may change too (the Director sends it with the rest of the show)
const SHARED = ["ticker", "defBg", "awards", "awFolders", "awTitle", "awLoc", "pool", "pools", "winners", "prize", "prizes", "rafMusic", "rafName"];
const pickShared = (o) => Object.fromEntries(SHARED.filter((k) => k in o).map((k) => [k, o[k]]));
const ROLE = { director: "🎬 Director", editor: "✏ Editor", screen: "📺 Live screen" };

// samePc: this browser runs on the computer that runs the server (it can switch to http://localhost)
export const NET = { server: false, on: false, you: null, users: [], ice: [], msg: "", samePc: false };
let ws = null,
  creds = null,
  denied = false,
  firstWelcome = true,
  retry = 0,
  base = { order: "", show: "", segs: {}, lib: new Map() };

export function storedCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(CK));
    return c && c.name && c.code ? c : null;
  } catch {
    return null;
  }
}
/** May this computer change what is on air? (true when working alone, or signed in as Director) */
export const canControl = () => !creds || creds.role === "director";
/** The location this computer is operating at ("" when working alone). */
export const myLoc = () => (creds && creds.loc) || "";
/**
 * Segment photos, songs and videos can be locked to one location (g.mloc[id] = "cebu" | "ncr" | "cdo"; none = all).
 * mediaLoc() = the location whose media this computer plays: an Editor's own, the Director's (Cebu unless set),
 * "" when working alone (everything). segList(g, k) = the segment's list k ("aud" | "vid" | "img") for it.
 */
export const mediaLoc = () => (LOCS[myLoc()] ? myLoc() : creds && creds.role === "director" ? "cebu" : "");
export const segList = (g, k, loc = mediaLoc()) => {
  const m = (g && g.mloc) || {};
  return ((g && g[k]) || []).filter((id) => !LOCS[m[id]] || !loc || m[id] === loc);
};
/**
 * May this computer change segment g? The Director and anyone working alone: always. An Editor: segments
 * of their own location and the ones shared by all locations ("" ), so two venues never edit the same one.
 * (The server checks this too.)
 */
export const canEditSeg = (g) => !creds || creds.role === "director" || !g || !g.loc || g.loc === creds.loc;
export const netSend = (m) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
};

/* ---------- start ---------- */
export async function netStart() {
  let info = null;
  try {
    const r = await fetch("/api/info", { cache: "no-store" });
    if (r.ok) info = await r.json();
  } catch {
    /* no server: single-computer mode */
  }
  if (!info || info.app !== "vienovo-telecast") return;
  NET.server = true;
  NET.samePc = !!info.samePc;
  const c = storedCreds();
  // signed in before locations existed: ask once more, so they pick theirs
  if (c && c.loc && LOCS[c.loc] && (LIVE || c.role !== "screen")) {
    creds = c;
    connect();
  } else showLogin();
  render();
}

function connect(takeover) {
  denied = false;
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => {
    retry = 0;
    netSend({
      t: "hello",
      name: LIVE ? creds.name.replace(/ \(screen\)$/, "") + " (screen)" : creds.name,
      role: LIVE ? "screen" : creds.role,
      code: creds.code,
      loc: creds.loc || "",
      takeover: !!takeover,
    });
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(m);
  };
  ws.onclose = () => {
    NET.on = false;
    render();
    if (!creds || denied) return;
    setTimeout(() => creds && !denied && connect(), Math.min(10000, 1000 * 2 ** retry++));
  };
}

function handle(m) {
  switch (m.t) {
    case "denied":
      denied = true;
      ws.close();
      showLogin(m.msg, m.busy);
      break;
    case "welcome": {
      NET.on = true;
      NET.you = m.you;
      NET.ice = m.ice || [];
      NET.msg = "";
      // measure this PC's clock against the server's (a few samples; the quickest answer is the most precise)
      resetClock();
      [0, 700, 1500, 3000].forEach((t) => setTimeout(() => askTime(netSend), t));
      const dir = m.you.role === "director";
      if (m.S) applyRemote(m.S, true);
      else if (dir) {
        netSend({ t: "seed", S: shareable() });
        snapshot();
      } else {
        snapshot();
        NET.msg = "Waiting for the Director to connect for the first time…";
      }
      if (dir && firstWelcome && !LIVE) {
        if (S.call) S.call = null; // a call shared before this page was opened is gone
        holdOnOpen(); // opening the control room never starts the program
        flush();
      }
      firstWelcome = false;
      localStorage.setItem(CK, JSON.stringify({ ...creds, role: LIVE ? creds.role : m.you.role }));
      hideLogin();
      if (!LIVE) shareLocalFiles();
      autoSaveMedia(); // each location keeps its own copy of the show's media
      onCallState();
      render();
      break;
    }
    case "state":
      applyRemote(m.S, LIVE || !canControl());
      onCallState();
      break;
    case "users":
      NET.users = m.users || [];
      render();
      break;
    case "role":
      creds.role = m.role;
      NET.you.role = m.role;
      NET.msg = m.msg || "";
      localStorage.setItem(CK, JSON.stringify(creds));
      stopLocalCall();
      render();
      break;
    case "time":
      onTime(m);
      break;
    case "director-left":
      onDirectorLeft();
      break;
    case "rtc-want":
    case "rtc":
      onRtc(m).catch(() => {});
      break;
  }
}

// keep the clocks aligned during a long show (PC clocks drift, Windows may correct them at any time)
setInterval(() => NET.on && askTime(netSend), 30000);

/* ---------- state in / out ---------- */
const shareable = () => {
  const o = { ...S };
  for (const k of LOCAL) delete o[k];
  return o;
};
function snapshot() {
  const { segs, lib, ...rest } = shareable();
  base = {
    order: segs.map((g) => g.id).join(),
    show: JSON.stringify(rest),
    shared: JSON.stringify(pickShared(rest)),
    segs: Object.fromEntries(segs.map((g) => [g.id, JSON.stringify(g)])),
    lib: new Map(lib.map((x) => [x.id, JSON.stringify(x)])),
  };
}

/** Take the server's state. `full` = everything; otherwise (director) only segments + library. */
function applyRemote(R, full) {
  if (!R) return;
  if (pending()) flush(); // send our own unsent typing first
  const keep = {};
  for (const k of LOCAL) if (k in S) keep[k] = S[k];
  // an Editor keeps their own flow: the Director's Start / segment / music never plays on an Editor's computer
  const ownSeg = !LIVE && NET.you && NET.you.role === "editor";
  if (ownSeg) for (const k of PLAY) keep[k] = S[k];
  // segments are counted by position: remember which ones we were on, in case some were inserted / deleted
  const segId = (S.segs[S.seg] || {}).id,
    edId = (S.segs[S.edit] || {}).id;
  // an Editor's own location's raffle names / prize: a server copy that doesn't have them (yet) never wipes them
  if (ownSeg && myLoc())
    for (const k of ["pools", "prizes"]) {
      const mine = S[k] && S[k][myLoc()];
      if (typeof mine === "string" && mine && !(R[k] && typeof R[k][myLoc()] === "string")) R = { ...R, [k]: { ...(R[k] || {}), [myLoc()]: mine } };
    }
  if (full) setS({ ...DEF, ...R, ...keep });
  else setS({ ...S, segs: R.segs, lib: R.lib, ...pickShared(R) }); // the Director also takes an Editor's ticker / awards / raffle changes
  fixSegs();
  const at = (id) => S.segs.findIndex((g) => g.id === id);
  if ((ownSeg || !full) && at(segId) >= 0) S.seg = at(segId);
  if (at(edId) >= 0) S.edit = at(edId);
  if (!(S.seg < S.segs.length)) S.seg = S.segs.length - 1;
  if (!(S.edit < S.segs.length)) S.edit = 0;
  snapshot();
  // keep a local copy + update this computer's pop-out, without echoing back. A Live screen keeps no copy:
  // it shares the browser's storage with the control room, whose (Editor's) own flow must not be overwritten.
  if (!LIVE) flush(true);
  render();
}

/** keys raffle data is kept per location in: only the locations that changed are sent */
const PER_LOC = ["pools", "prizes"];
/** the Director's show update: changed keys only; raffle names / prizes / winners only for the locations that changed */
function showPatch(now, prev) {
  const P = {},
    J = JSON.stringify;
  for (const k of Object.keys(now)) if (J(now[k]) !== J(prev[k])) P[k] = now[k];
  for (const k of PER_LOC)
    if (P[k] && typeof P[k] === "object") {
      const was = prev[k] && typeof prev[k] === "object" ? prev[k] : {};
      P[k] = Object.fromEntries(Object.entries(P[k]).filter(([l, v]) => J(v) !== J(was[l])));
    }
  if (Array.isArray(P.winners)) {
    const by = (list) => {
        const m = {};
        for (const w of list || []) (m[w.loc || "cebu"] ||= []).push(w);
        return m;
      },
      a = by(P.winners),
      b = by(prev.winners),
      locs = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((l) => J(a[l] || []) !== J(b[l] || []));
    P.winners = P.winners.filter((w) => locs.includes(w.loc || "cebu"));
    P.winnersLocs = locs;
  }
  return P;
}

/** Called by flush(): send what changed since the last snapshot. */
export function netPush() {
  if (!NET.on || LIVE) return;
  const role = NET.you.role;
  if (role === "screen") return;
  const { segs, lib, ...rest } = shareable();
  // inserted / deleted segments first, so the server shifts its "segment on air" before our show update arrives
  segs.forEach((g, i) => {
    if (base.segs[g.id] !== undefined) return;
    netSend({ t: "seg-add", seg: g, after: i ? segs[i - 1].id : null });
    base.segs[g.id] = JSON.stringify(g);
  });
  for (const id of Object.keys(base.segs))
    if (!segs.some((g) => g.id === id)) {
      netSend({ t: "seg-del", id });
      delete base.segs[id];
    }
  if (segs.map((g) => g.id).join() !== base.order) {
    // segments were dragged to a new position (after any added / deleted ones, before the show update)
    base.order = segs.map((g) => g.id).join();
    netSend({ t: "seg-order", ids: segs.map((g) => g.id) });
  }
  if (role === "director") {
    const j = JSON.stringify(rest);
    if (j !== base.show) {
      // only what changed since the last send, so an Editor's ticker / awards / raffle names that reached the
      // server meanwhile are never overwritten by this computer's older copy
      netSend({ t: "show", S: showPatch(rest, base.show ? JSON.parse(base.show) : {}), patch: 1 });
      base.show = j;
    }
  } else {
    // an Editor: only the show-wide content (ticker, awards, raffle list); their own flow stays on this computer
    const sh = pickShared(rest),
      j = JSON.stringify(sh);
    if (j !== base.shared) {
      netSend({ t: "shared", S: sh });
      base.shared = j;
    }
  }
  for (const g of segs) {
    const j = JSON.stringify(g);
    if (base.segs[g.id] !== j) {
      netSend({ t: "seg", seg: g });
      base.segs[g.id] = j;
    }
  }
  const items = lib.filter((x) => base.lib.get(x.id) !== JSON.stringify(x));
  if (items.length) {
    netSend({ t: "lib", items });
    for (const x of items) base.lib.set(x.id, JSON.stringify(x));
  }
  {
    // the Director may delete anything; an Editor only sound effects (they are not used in any segment)
    const gone = [...base.lib.keys()].filter(
      (id) => !lib.some((x) => x.id === id) && (role === "director" || JSON.parse(base.lib.get(id)).kind === "sfx"),
    );
    if (gone.length) {
      netSend({ t: "lib-del", ids: gone });
      for (const id of gone) base.lib.delete(id);
    }
  }
}

/* ---------- media on the server ---------- */
/** Upload a file to the server; resolves { id, url, size }. */
export function uploadFile(f, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/upload");
    x.setRequestHeader("x-show-code", creds.code);
    x.setRequestHeader("x-file-name", encodeURIComponent(f.name || "file"));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => (x.status === 200 ? ok(JSON.parse(x.responseText)) : no(new Error(x.responseText)));
    x.onerror = () => no(new Error("network"));
    x.send(f);
  });
}

/** Files uploaded earlier into this browser only (IndexedDB) are copied to the server so other places get them. */
let sharing = false;
async function shareLocalFiles() {
  if (sharing) return;
  sharing = true;
  try {
    const todo = S.lib.filter((m) => !m.url && !BUNDLED[m.id]);
    for (const extra of [S.defBg, S.rafMusic]) if (extra && !BUNDLED[extra] && !(S.urls || {})[extra]) todo.push({ id: extra });
    for (const m of todo) {
      const r = await tx("readonly", (s) => s.get(m.id)).catch(() => null);
      if (!r || !r.blob || !NET.on) continue;
      const res = await uploadFile(r.blob).catch(() => null);
      if (!res) continue;
      const it = S.lib.find((x) => x.id === m.id);
      if (it) it.url = res.url;
      else S.urls = { ...S.urls, [m.id]: res.url };
      flush();
    }
  } finally {
    sharing = false;
  }
}

/* ---------- sign-in dialog ---------- */
function showLogin(err, busy) {
  hideLogin();
  const d = document.createElement("div");
  d.id = "login";
  const c = storedCreds() || {};
  d.innerHTML = `<form class="cc"><h3>${LIVE ? "📺 Connect this live screen" : "👥 Join the Telecast"}</h3>
 <p class="mut">${LIVE ? "This screen will show the program from the Director." : "Several people can prepare and run this show at the same time from different locations."}</p>
 <div class="row"><input class="g" name="name" placeholder="Your name or location (e.g. Cebu hub)" required value="${esc(c.name || "")}"></div>
 ${
   LIVE
     ? '<input type="hidden" name="role" value="screen">'
     : `<div class="row"><select class="g" name="role">${Object.entries({
         director: "🎬 Director: runs the show (only one)",
         editor: "✏ Editor: edits segments, uploads media",
         screen: "📺 Live screen: shows the program at a location",
       })
         .map(([k, v]) => `<option value="${k}" ${c.role === k ? "selected" : ""}>${v}</option>`)
         .join("")}</select></div>`
 }
 <div class="row"><select class="g" name="loc" required title="The venue you are operating at"><option value="">📍 Which location are you at?</option>${Object.entries(LOCS)
   .map(([k, v]) => `<option value="${k}" ${c.loc === k ? "selected" : ""}>📍 ${esc(v)}</option>`)
   .join("")}</select></div>
 <div class="row"><input class="g" name="code" type="password" placeholder="Access code" required value="${esc(c.code || "")}"></div>
 ${err ? `<div class="err">⚠ ${esc(err)}</div>` : ""}
 <div class="row" style="justify-content:center"><button class="p">Join</button>${busy ? '<button type="button" data-take>Take over as Director</button>' : ""}${LIVE ? "" : '<button type="button" data-solo>Work offline on this computer</button>'}</div></form>`;
  document.body.appendChild(d);
  const f = d.querySelector("form");
  const go = (takeover) => {
    const v = Object.fromEntries(new FormData(f));
    creds = { name: v.name.trim(), role: v.role, code: v.code.trim(), loc: v.loc };
    if (!creds.name || !creds.code || !LOCS[creds.loc]) return;
    if (creds.role === "screen" && !LIVE) {
      localStorage.setItem(CK, JSON.stringify(creds));
      location.href = location.href.split("#")[0] + "#live";
      location.reload();
      return;
    }
    connect(takeover);
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    go(false);
  };
  const t = d.querySelector("[data-take]");
  if (t) t.onclick = () => go(true);
  const s = d.querySelector("[data-solo]");
  if (s)
    s.onclick = () => {
      creds = null;
      hideLogin();
      render();
    };
  f.querySelector("input[name=name]").focus();
}
function hideLogin() {
  document.getElementById("login")?.remove();
}
export function signOut() {
  creds = null;
  localStorage.removeItem(CK);
  stopLocalCall();
  try {
    ws && ws.close();
  } catch {
    /* already closed */
  }
  location.reload();
}

/** Header chip: who am I, who else is online. */
export function renderNet(n) {
  let h = "";
  if (NET.server) {
    if (!creds) h = '<button id="netjoin">👥 Join shared show</button>';
    else if (!NET.on) h = '<span class="netst off">⚠ Reconnecting to the server…</span>';
    else {
      const list = NET.users.map((u) => ROLE[u.role] + ": " + u.name + (LOCS[u.loc] ? " · 📍 " + LOCS[u.loc] : "")).join("\n");
      h = `<span class="netst on" title="${esc(list)}">🟢 ${esc(NET.you.name)} · ${ROLE[NET.you.role]}${LOCS[myLoc()] ? " · 📍 " + esc(LOCS[myLoc()]) : ""} · ${NET.users.length} online</span><button id="netout">Sign out</button>`;
    }
    if (NET.msg) h += `<span class="mut">${esc(NET.msg)}</span>`;
  }
  if (n._h === h) return;
  n._h = h;
  n.innerHTML = h;
  const j = n.querySelector("#netjoin");
  if (j) j.onclick = () => showLogin();
  const o = n.querySelector("#netout");
  if (o) o.onclick = signOut;
}
