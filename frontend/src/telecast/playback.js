/** Audio/video playback commands and keeping the control-room monitor in step with the live screen. */
import { segList } from "./net.js";
import { $, fm } from "./constants.js";
import { S } from "./state.js";
import { done } from "./sync.js";
import { url } from "./media.js";
import BUNDLED from "../data/mediaManifest.json";

let lastPos = null;
async function followPop(d) {
  if (!S.cmd || S.cmd.ts !== d.ts) return;
  const el = document.getElementById("prev"),
    np = document.getElementById("np");
  if (d.kind === "vid") {
    lastPos = { ts: d.ts, paused: d.paused, at: Date.now() };
    if (np) np.textContent = (d.paused ? "\u23f8 " : "\u25b6 ") + "Video " + fm(d.time) + " / " + fm(d.dur || 0);
    const v = el.querySelector("video");
    if (!v || !v.getAttribute("src") || v.readyState < 1) return;
    if (d.paused !== v.paused) {
      el._pc = (el._pc || 0) + 1;
      if (el._pc >= 2) {
        el._pc = 0;
        if (d.paused) v.pause();
        else v.play().catch(() => {});
      }
    } else el._pc = 0;
    if (!d.paused && !v.seeking && Math.abs(d.time - v.currentTime) > 1.2 && Date.now() - (el._sk || 0) > 3000) {
      el._sk = Date.now();
      v.currentTime = d.time + 0.1;
    }
    return;
  }
  if (el._ld) return;
  const m0 = S.lib.find((x) => x.id === S.cmd.ids[d.i]);
  if (!S.monSound) {
    // monitor is muted: just show what plays, don't download the song a second time on this computer
    if (el._a && !el._a.paused) el._a.pause();
    el._ai = -1;
    if (np) np.textContent = (d.paused ? "⏸ " : "🎵 ") + (m0 ? m0.name : "Music") + "  " + fm(d.time);
    return;
  }
  const a = el._a || (el._a = new Audio());
  a.muted = !S.monSound;
  if (el._ai !== d.i || !a.src) {
    el._ld = 1;
    el._ai = d.i;
    a.src = await url(S.cmd.ids[d.i] || "");
    await new Promise((ok) => {
      a.onloadedmetadata = ok;
      setTimeout(ok, 3000);
    });
    el._ld = 0;
  }
  if (d.paused) {
    if (!a.paused) a.pause();
  } else if (a.paused) a.play().catch(() => {});
  if (Math.abs(a.currentTime - d.time) > 0.25) a.currentTime = d.time + 0.05;
  const m = S.lib.find((x) => x.id === S.cmd.ids[d.i]);
  if (np)
    np.textContent =
      (d.paused ? "⏸ " : "🎵 ") + (m ? m.name : "Music") + "  " + fm(d.time) + " / " + fm(a.duration || 0);
}
async function doCmd(el, mute) {
  const c = S.cmd;
  if (!c || el._ts === c.ts) return;
  el._ts = c.ts;
  const v = $(el, "video"),
    a = el._a || (el._a = new Audio()),
    fail = () => {
      el._gate = 1;
      $(el, ".gate").style.display = "flex";
    };
  if (c.action === "stop") {
    v.pause();
    v.removeAttribute("src");
    v.load();
    a.pause();
    return;
  }
  if (c.action === "pause") {
    v.pause();
    a.pause();
    return;
  }
  if (c.action === "resume") {
    // continue what was loaded; if nothing was (e.g. screen opened while paused) start it fresh below
    if (c.kind === "vid" && v.getAttribute("src")) {
      v.play().catch(fail);
      return;
    }
    if (c.kind === "aud" && a.src) {
      if (!mute) a.play().catch(fail);
      return;
    }
  }
  if (c.action === "toggle") {
    const t = c.kind === "vid" ? v : a;
    t.paused ? t.play().catch(fail) : t.pause();
    return;
  }
  if (c.kind === "vid") {
    a.pause();
    v.muted = !!mute;
    v.onended = mute ? null : () => done(c.ts);
    v.onloadedmetadata = () => {
      if (window._vt && window._vtTs === c.ts) {
        v.currentTime = window._vt;
        window._vt = 0;
      }
    };
    v.src = await url(c.ids[0]);
    if (!mute)
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
        fail();
      });
    // a monitor while a Live Screen plays it: play along, muted (the Live Screen's position keeps it in step)
    else v.play().catch(() => {});
  } else {
    v.pause();
    if (mute) return;
    let i = window._ap && window._apTs === c.ts ? window._ap.i || 0 : c.start || 0,
      bad = 0;
    a.preload = "auto";
    // this playlist is still the one on air (pause / resume / ⏯ keep it alive via `orig`)
    const alive = () => {
      const k = S.cmd;
      return !!k && (k.ts === c.ts || k.orig === c.ts) && k.action !== "stop";
    };
    const loop = () => c.loop || (S.segs.find((s) => s.id === c.seg) || {}).loop;
    const upcoming = (k) => (k + 1 < c.ids.length ? c.ids[k + 1] : loop() ? c.ids[0] : nextSegSong());
    const play = () =>
      a.play().catch((e) => {
        if (e && e.name === "NotAllowedError") return fail(); // needs one click on this screen
        setTimeout(() => alive() && a.paused && a.play().catch(fail), 400); // interrupted load: try again
      });
    const nx = async () => {
      if (!alive()) return;
      if (i >= c.ids.length) {
        if (c.ids.length && loop()) i = 0;
        else return done(c.ts);
      }
      el._i = i;
      const id = c.ids[i],
        u = ready(id) || (await url(id)); // already downloaded = starts instantly
      if (!alive()) return;
      if (!u) {
        if (++bad >= c.ids.length) return done(c.ts);
        i++;
        return nx();
      }
      bad = 0;
      a.src = u;
      a.onloadedmetadata = null;
      if (window._ap && window._apTs === c.ts && window._ap.i === i) {
        const t0 = window._ap.time;
        window._ap = null;
        a.onloadedmetadata = () => {
          a.currentTime = t0;
          a.onloadedmetadata = null;
        };
      }
      play();
      // download the next song (and the next segment's first song) while this one plays
      const keep = [id, upcoming(i), nextSegSong()];
      keepPre(keep);
      keep.slice(1).forEach(prefetch);
    };
    const next = () => {
      if (!alive()) return;
      i++;
      nx();
    };
    a.onended = next;
    a.onerror = () => a.getAttribute("src") && next(); // unplayable file: skip it, never stop the show
    el._wd = { alive, next, t: -1, at: Date.now(), rec: 0, endAt: 0 };
    watched.add(el);
    nx();
  }
}

/* ---------- music without gaps or stalls ----------
 * The music files are large (often full music videos). Streaming them can stall when data arrives late,
 * and a stalled song never fires "ended", so the playlist would stop. Two safeguards:
 *  1. the next song is downloaded completely into memory while the current one plays, so it starts instantly
 *  2. a watchdog notices a song that stopped moving: near the end it moves on, otherwise it reconnects
 *     at the same spot, and after two failed tries it skips to the next song.
 */
const MAXPRE = 160 * 1048576; // larger files (full albums) are streamed instead of kept in memory
const pre = new Map(); // id -> { p, url }
const sizeOf = (id) => {
  const m = (S.lib || []).find((x) => x.id === id);
  return (m && m.size) || (BUNDLED[id] && BUNDLED[id].size) || 0;
};
function prefetch(id) {
  if (!id || pre.has(id)) return;
  const e = { url: "" };
  e.p = url(id)
    .then(async (u) => {
      if (!u || /^(blob|data):/.test(u) || sizeOf(id) > MAXPRE) return;
      const r = await fetch(u);
      if (!r.ok) throw new Error(String(r.status));
      const b = await r.blob();
      if (pre.get(id) === e) e.url = URL.createObjectURL(b);
    })
    .catch(() => pre.get(id) === e && pre.delete(id));
  pre.set(id, e);
}
/** free downloaded songs that are no longer coming up */
function keepPre(ids) {
  for (const [id, e] of pre)
    if (!ids.includes(id)) {
      if (e.url) URL.revokeObjectURL(e.url);
      pre.delete(id);
    }
}
const ready = (id) => (pre.get(id) && pre.get(id).url) || "";
/** first song of the next segment (unless that segment opens with a video) */
function nextSegSong() {
  const n = S.segs[S.seg + 1];
  return n && !(n.av && segList(n, "vid")[0]) ? segList(n, "aud")[0] || null : null;
}

const watched = new Set();
setInterval(() => {
  for (const el of watched) {
    const a = el._a,
      w = el._wd;
    if (!a || !w || !w.alive()) {
      watched.delete(el);
      continue;
    }
    const now = Date.now();
    if (a.ended) {
      // finished, but the "ended" event was lost
      if (!w.endAt) w.endAt = now;
      else if (now - w.endAt > 1500) {
        w.endAt = 0;
        w.next();
      }
      continue;
    }
    w.endAt = 0;
    if (a.paused || !a.getAttribute("src") || a.currentTime !== w.t) {
      w.t = a.currentTime;
      w.at = now;
      if (!a.paused) w.rec = 0;
      continue;
    }
    const stuck = now - w.at,
      left = (a.duration || 0) - a.currentTime;
    if (isFinite(left) && left < 1.5 && stuck > 1500) {
      w.at = now; // stalled in the last second: treat as finished
      w.next();
    } else if (stuck > 4000) {
      w.at = now;
      if (w.rec++ < 2) {
        const t = a.currentTime; // reconnect and carry on from the same spot
        a.addEventListener(
          "loadedmetadata",
          () => {
            a.currentTime = t;
            a.play().catch(() => {});
          },
          { once: true },
        );
        a.load();
      } else {
        w.rec = 0;
        w.next();
      }
    }
  }
}, 1000);
const vidPlaying = () => {
  const c = S.cmd;
  if (!c || c.kind !== "vid" || c.action === "stop") return false;
  const v = document.querySelector("#prev video");
  if (v && v.getAttribute("src") && !v.paused && !v.ended) return true;
  return !!lastPos && lastPos.ts === c.ts && !lastPos.paused && Date.now() - lastPos.at < 3000;
};
function startRaf() {
  S.cmd = { ts: Date.now(), kind: "aud", action: "play", ids: [S.rafMusic || "raf-default"], loop: true, seg: "raf" };
}
const rafOn = () => S.cmd && S.cmd.seg === "raf" && S.cmd.action !== "stop";

export { followPop, doCmd, vidPlaying, startRaf, rafOn };
