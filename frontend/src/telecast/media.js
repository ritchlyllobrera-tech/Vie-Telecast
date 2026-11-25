/** Media store: IndexedDB for uploads, with the extracted files in public/assets/media as fallback. */
import BUNDLED from "../data/mediaManifest.json";
import { RAFM, esc, MB } from "./constants.js";
import { S } from "./state.js";
import { LIVE, save, flush } from "./sync.js";
import { NET, uploadFile } from "./net.js";

/* media store (IndexedDB) */
const idb = new Promise((ok, no) => {
  const r = indexedDB.open("vtc_media", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("m", { keyPath: "id" });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
idb.catch(() => {});
const tx = (m, f) =>
  idb.then(
    (d) =>
      new Promise((ok, no) => {
        const t = d.transaction("m", m),
          q = f(t.objectStore("m"));
        t.oncomplete = () => ok(q && q.result);
        t.onerror = () => no(t.error);
      }),
  );
const urls = {},
  pend = {},
  inf = {},
  url = (id) =>
    id === "raf-default"
      ? Promise.resolve(RAFM)
      : urls[id]
        ? Promise.resolve(urls[id])
        : (inf[id] =
            inf[id] ||
            load(id).then((u) => {
              delete inf[id];
              return u;
            }));
async function load(id) {
  let u = await tx("readonly", (s) => s.get(id))
    .then((r) => (r ? URL.createObjectURL(r.blob) : ""))
    .catch(() => "");
  if (!u && BUNDLED[id]) u = BUNDLED[id].url;
  if (!u) {
    // uploaded to the shared server (multi-user mode)
    const it = (S.lib || []).find((m) => m.id === id);
    u = (it && it.url) || (S.urls || {})[id] || "";
  }
  if (!u && LIVE && window.opener)
    u = await new Promise((ok) => {
      pend[id] = ok;
      try {
        window.opener.postMessage({ t: "need", id }, location.origin === "null" ? "*" : location.origin);
      } catch (x) {
        ok("");
      }
      setTimeout(() => {
        if (pend[id]) {
          delete pend[id];
          ok("");
        }
      }, 20000);
    });
  if (u) urls[id] = u;
  return u;
}
function upMsg(h) {
  const e = document.getElementById("upst");
  if (e) {
    e.innerHTML = h;
    e.style.display = h ? "block" : "none";
  }
}
/** Upload files once into the shared media library (kind: aud | vid | img | sfx). */
async function uploadToLib(kind, files) {
  let ok = 0,
    sz = 0,
    big = false;
  const fail = [],
    skip = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    if (S.lib.some((m) => m.kind === kind && m.name === f.name && m.size === f.size)) {
      skip.push(f.name); // same file already uploaded - don't store it twice
      continue;
    }
    upMsg(
      "\u23f3 Uploading " + (k + 1) + " of " + files.length + ": <b>" + esc(f.name) + "</b> (" + MB(f.size) + ")\u2026",
    );
    const id = "m" + Date.now() + Math.random().toString(36).slice(2, 6);
    try {
      if (NET.on) {
        // shared show: the file goes to the server once, every location streams it from there
        const head = "⏳ Uploading " + (k + 1) + " of " + files.length + ": <b>" + esc(f.name) + "</b> (" + MB(f.size) + ") ";
        const res = await uploadFile(f, (p) => upMsg(head + Math.round(p * 100) + "%"));
        if (res.size !== f.size) throw 0;
        S.lib.push({ id: res.id, kind, name: f.name, size: f.size, url: res.url });
        ok++;
        sz += f.size;
        flush();
        continue;
      }
      await tx("readwrite", (s) => s.put({ id, blob: f }));
      const back = await tx("readonly", (s) => s.get(id));
      if (!back || !back.blob || back.blob.size !== f.size) throw 0;
      S.lib.push({ id, kind, name: f.name, size: f.size });
      ok++;
      sz += f.size;
    } catch (e) {
      fail.push(f.name);
      if (e && /too large/i.test(e.message)) big = true;
    }
  }
  save();
  upMsg(
    (ok ? "\u2714 " + ok + " file" + (ok > 1 ? "s" : "") + " added to the library (" + MB(sz) + "). " : "") +
      (skip.length ? "Already in the library: " + skip.map(esc).join(", ") + ". " : "") +
      (fail.length ? "\u26a0 Not saved: " + fail.map(esc).join(", ") + (big ? " (file too large for this server)" : "") : ""),
  );
  if (!fail.length) setTimeout(() => upMsg(""), 7000);
}

/** Store one file (default background, raffle music). Resolves its id, or throws. */
async function storeFile(prefix, f) {
  if (NET.on) {
    const res = await uploadFile(f);
    S.urls = { ...S.urls, [res.id]: res.url };
    return res.id;
  }
  const id = prefix + Date.now();
  await tx("readwrite", (x) => x.put({ id, blob: f }));
  const b = await tx("readonly", (x) => x.get(id));
  if (!b || !b.blob || b.blob.size !== f.size) throw new Error("not saved");
  return id;
}

/* ---------- "Save media on this PC" ----------
 * Every location keeps its own copy of the show's videos, music and pictures in this browser (IndexedDB,
 * marked cache: 1), so during the show they play from the local disk instead of streaming from the server
 * PC over the internet. load() already looks in IndexedDB first.
 *
 *  - big files come down in 4 parallel pieces (about twice as fast over a tunnel as one stream)
 *  - it runs by itself in the background, the next segments first
 *  - it pauses during the live call (the call streams from the Director's PC too) and, while the show is
 *    running, only fetches the current and next segments, one piece at a time, to leave room for the show
 */
const PIECES = 4,
  PIECE_FROM = 12 * 1048576; // smaller files come in one request
const btns = new Set(); // every "Save media" button on this page shows the same progress
let saving = false,
  status = "⬇ Save media on this PC";
const say = (t) => {
  status = t;
  for (const b of btns) b.isConnected ? (b.textContent = t) : btns.delete(b);
};
/** a "Save media on this PC" button: shows the progress, and saves everything now when pressed */
function mediaButton(b) {
  btns.add(b);
  b.textContent = status;
  b.onclick = (e) => {
    e.stopPropagation();
    saveMedia(false, true);
  };
}
const srcOf = (id) =>
  (BUNDLED[id] && BUNDLED[id].url) || ((S.lib || []).find((m) => m.id === id) || {}).url || (S.urls || {})[id] || "";
const sizeOf = (id) => ((S.lib || []).find((m) => m.id === id) || {}).size || (BUNDLED[id] && BUNDLED[id].size) || 0;

/** what to save, in order: the segment on air and the next one first, then the rest of the rundown, then the library */
function wanted(soonOnly) {
  const out = [],
    add = (id) => id && !out.includes(id) && srcOf(id) && out.push(id),
    segFiles = (g) => g && [...(g.vid || []), ...(g.aud || []), ...(g.img || []), g.bg].forEach(add),
    at = Math.max(0, S.seg || 0);
  segFiles(S.segs[at]);
  segFiles(S.segs[at + 1]);
  if (soonOnly) return out;
  S.segs.slice(at + 2).forEach(segFiles);
  S.segs.slice(0, at).forEach(segFiles);
  [S.defBg, S.rafMusic, ...(S.lib || []).map((m) => m.id)].forEach(add);
  return out;
}

async function getRange(u, a, b) {
  const r = await fetch(u, { headers: { Range: `bytes=${a}-${b}` } });
  if (r.status !== 206) throw new Error("no range " + r.status);
  const x = await r.blob();
  if (x.size !== b - a + 1) throw new Error("short piece");
  return { x, type: r.headers.get("content-type") || "" };
}
/** download one file, in parallel pieces when it is big */
async function fetchFile(u, size, pieces) {
  if (!size) {
    // size unknown: ask for the first byte, the answer says how big the file is
    const r = await fetch(u, { headers: { Range: "bytes=0-0" } });
    size = r.status === 206 ? +(r.headers.get("content-range") || "").split("/")[1] || 0 : 0;
    await r.blob().catch(() => {});
  }
  if (pieces > 1 && size >= PIECE_FROM) {
    try {
      const part = Math.ceil(size / pieces),
        got = await Promise.all(
          Array.from({ length: pieces }, (_, i) => getRange(u, i * part, Math.min(size, (i + 1) * part) - 1)),
        );
      return new Blob(
        got.map((g) => g.x),
        { type: got[0].type },
      );
    } catch {
      /* the server or a proxy did not like pieces: one request below */
    }
  }
  const r = await fetch(u);
  if (!r.ok) throw new Error("http " + r.status);
  return r.blob();
}

/**
 * Save the show's media into this browser.
 * auto = the background run (respects the live call and the running show); manual = everything, now.
 */
async function saveMedia(auto, manual) {
  if (saving) return;
  if (auto && S.call && S.call.live) {
    say("⏸ Saving media: paused during the live call");
    return;
  }
  saving = true;
  try {
    try {
      navigator.storage && navigator.storage.persist && navigator.storage.persist(); // don't let the browser evict it
    } catch {
      /* not available on http addresses */
    }
    const soon = auto && S.running,
      ids = wanted(soon),
      todo = [];
    for (const id of ids) {
      const have = await tx("readonly", (s) => s.getKey(id)).catch(() => undefined);
      if (have === undefined) todo.push(id);
    }
    if (!todo.length) {
      if (!soon || manual) say("✔ All media is on this PC");
      return;
    }
    let n = 0,
      bytes = 0,
      fail = 0,
      full = false;
    for (const id of todo) {
      if (auto && S.call && S.call.live) {
        say("⏸ Saving media: paused during the live call");
        return;
      }
      // another window on this computer may have saved it meanwhile
      if ((await tx("readonly", (s) => s.getKey(id)).catch(() => undefined)) !== undefined) continue;
      say(`⬇ Saving media ${++n} of ${todo.length} (${MB(bytes)})…`);
      try {
        const b = await fetchFile(srcOf(id), sizeOf(id), soon ? 1 : PIECES);
        await tx("readwrite", (s) => s.put({ id, blob: b, cache: 1 }));
        bytes += b.size;
        delete urls[id]; // next time it is used, it comes from this computer
      } catch (e) {
        fail++;
        if (e && e.name === "QuotaExceededError") {
          full = true;
          break;
        }
      }
    }
    say(
      full
        ? "⚠ Disk full: some media not saved"
        : fail
          ? `⚠ ${fail} file${fail > 1 ? "s" : ""} not saved yet (tries again)`
          : soon
            ? "⬇ Next segments saved (the rest after the show pauses)"
            : "✔ All media is on this PC",
    );
  } finally {
    saving = false;
  }
}

/** Start saving in the background (called once signed in). The server PC itself does not need copies. */
let autoOn = false;
function autoSaveMedia() {
  if (autoOn || NET.samePc) return;
  if (LIVE && window.opener) return; // a pop-out shares this computer's copies with its control room
  autoOn = true;
  setTimeout(() => saveMedia(true), 4000); // let the page settle first
  setInterval(() => NET.on && saveMedia(true), 20000); // new uploads, the next segment, after the call
}

export { idb, tx, urls, pend, url, load, upMsg, uploadToLib, storeFile, mediaButton, saveMedia, autoSaveMedia };