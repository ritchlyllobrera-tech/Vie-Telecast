/** Saving + syncing state between the control room and the live screen (BroadcastChannel, postMessage, pop-out window). */
import { K } from "./constants.js";
import { S, setS } from "./state.js";
import { tx, urls, pend } from "./media.js";
import { followPop, rafOn } from "./playback.js";
import { setSeg } from "./actions.js";
import { dupTab } from "./control/control.js";
import { render } from "./render.js";
import { netPush, canControl } from "./net.js";

// MINE = an Editor's "Pop-out MY screen": a live-style window that mirrors THIS computer's own flow (no server link of its own)
const MINE = location.hash === "#mine" || window.name === "VienovoMine";
const LIVE = MINE || location.hash === "#live" || window.name === "VienovoLive";
// pop-outs are same-origin windows: never post to another origin ("null" = file://, which only accepts "*")
const TO = location.origin === "null" ? "*" : location.origin;
let liveAt = 0,
  ch = null;
try {
  ch = new BroadcastChannel("vienovo-telecast-sync-v1");
} catch (e) {}
const master = () => LIVE || Date.now() - liveAt > 5000;
/** Does this window's monitor play the sound / video itself? Not while a pop-out (Live screen / MY screen) is open and plays it. */
const ownOut = () => master();
const CTL = Math.random().toString(36).slice(2);
if (!LIVE && ch)
  setTimeout(() => {
    try {
      ch.postMessage({ t: "hi", id: CTL });
    } catch (e) {}
  }, 300);
let popWin = null;
const sendPop = (m) => {
  try {
    // ctl: false = an Editor's private flow, which a Live screen must not show
    popWin && !popWin.closed && popWin.postMessage({ ...m, ctl: canControl() }, TO);
  } catch (e) {}
};
let qt = 0;
const pending = () => !!qt;
/** Save locally and tell the live screens. fromNet = the change came from the server, so don't send it back. */
const flush = (fromNet) => {
  clearTimeout(qt);
  qt = 0;
  if (fromNet !== true) S.savedAt = Date.now();
  let j = "";
  try {
    j = JSON.stringify(S);
    localStorage.setItem(K, j);
  } catch (e) {}
  try {
    ch && ch.postMessage({ t: "state", S, ctl: canControl() });
  } catch (e) {}
  sendPop({ t: "state", S });
  if (fromNet !== true) netPush();
  if (!LIVE) {
    tx("readwrite", (s) => s.put({ id: "state", json: j })).catch(() => {});
    const sv = document.getElementById("sv");
    if (sv) sv.textContent = "✔ Saved " + new Date().toLocaleTimeString();
  }
};
const quiet = () => {
  if (!qt) qt = setTimeout(flush, 150);
};
addEventListener("pagehide", () => {
  if (qt) flush();
});
addEventListener("beforeunload", () => {
  if (qt) flush();
});
const save = () => {
  flush();
  render();
};
if (ch)
  ch.onmessage = (e) => {
    const d = e.data || {};
    if (d.t === "hb") liveAt = Date.now();
    else if (d.t === "pos") {
      if (!LIVE && canControl() && !popWin) followPop(d); // the Director's monitor follows a Live Screen tab
    }
    else if (d.t === "act") {
      if (!LIVE && canControl()) doAct(d.a);
    } else if (d.t === "ended") {
      if (!LIVE && canControl()) handleEnded(d.ts);
    } else if (d.S && LIVE && !MINE) {
      if (d.ctl === false) return; // an Editor's private flow

      setS(d.S);
      render();
    } else if (d.t === "hi" && !LIVE && d.id !== CTL) ch.postMessage({ t: "here", id: CTL });
    else if (d.t === "here" && !LIVE && d.id !== CTL) dupTab();
  };
addEventListener("storage", (e) => {
  if (ch || !LIVE) return;
  if (e.key === K && e.newValue) {
    try {
      setS(JSON.parse(e.newValue));
      render();
    } catch (x) {}
  }
});
if (LIVE) {
  const hb = () => {
    try {
      ch && ch.postMessage({ t: "hb" });
    } catch (e) {}
    try {
      window.opener && window.opener.postMessage({ t: "hb" }, TO);
    } catch (e) {}
  };
  setInterval(hb, 2000);
  hb();
  setInterval(() => {
    const el = document.getElementById("app"),
      c = S.cmd;
    if (!c || (!window.opener && !ch)) return;
    let m = null;
    if (c.kind === "vid") {
      const v = el.querySelector("video");
      if (v && v.getAttribute("src")) m = { time: v.currentTime, paused: v.paused, dur: v.duration };
    } else if (c.kind === "aud" && el._a && el._a.src)
      m = { time: el._a.currentTime, paused: el._a.paused, i: el._i || 0 };
    if (m) {
      try {
        window.opener && window.opener.postMessage({ t: "pos", ts: c.ts, kind: c.kind, ...m }, TO);
      } catch (e) {}
      // also to a control room in another tab / a refreshed control room (it follows the video it shows)
      if (!MINE)
        try {
          ch && ch.postMessage({ t: "pos", ts: c.ts, kind: c.kind, ...m });
        } catch (e) {}
    }
  }, 500);
  try {
    window.opener && window.opener.postMessage({ t: "ready" }, TO);
  } catch (e) {}
}
function popOut() {
  const mine = !canControl(); // an Editor's pop-out mirrors their own flow; the Director's is the Live screen
  const w = window.open("", mine ? "VienovoMine" : "VienovoLive", "width=1280,height=720");
  if (!w) {
    alert("The pop-out was blocked. Allow pop-ups for this page, then try again.");
    return;
  }
  popWin = w;
  try {
    if (w.document.body && w.document.body.classList.contains("live")) {
      w.focus();
      sendPop({ t: "state", S });
      return;
    }
    w.location.href = location.href.split("#")[0] + (mine ? "#mine" : "#live");
    w.focus();
  } catch (e) {
    alert("Could not open the live screen window. Use the Fullscreen preview button instead.");
  }
}
addEventListener("message", (e) => {
  const d = e.data || {};
  if (LIVE) {
    if (e.source !== window.opener) return;
    if (d.t === "state" && d.S) {
      if (d.ctl === false && !MINE) return; // a Live screen never shows an Editor's private flow ("MY screen" windows do)
      setS(d.S);
      {
        const ct = d.S.cmd ? d.S.cmd.ts : 0;
        if (d.vt) {
          window._vt = d.vt;
          window._vtTs = ct;
        }
        if (d.ap) {
          window._ap = d.ap;
          window._apTs = ct;
        }
      }
      render();
    } else if (d.t === "media") {
      const r = pend[d.id];
      if (r) {
        delete pend[d.id];
        r(d.blob ? (urls[d.id] = URL.createObjectURL(d.blob)) : "");
      }
    }
    return;
  }
  if (!popWin && d.t === "hb" && e.source && (e.source.name === "VienovoMine" || e.source.name === "VienovoLive") && e.source.opener === window) {
    // this page was reloaded while the Editor's "MY screen" window stayed open: pick it up again and bring it up to date
    popWin = e.source;
    sendPop({ t: "state", S });
  }
  if (!popWin || e.source !== popWin) return;
  if (d.t === "hb") {
    const was = master();
    liveAt = Date.now();
    if (was) render();
  } else if (d.t === "act") doAct(d.a);
  else if (d.t === "pos") followPop(d);
  else if (d.t === "ended") handleEnded(d.ts);
  else if (d.t === "ready")
    sendPop({
      t: "state",
      S,
      vt: (() => {
        const v = document.querySelector("#prev video");
        return v && v.getAttribute("src") && !v.paused ? v.currentTime : 0;
      })(),
      ap: (() => {
        const e = document.getElementById("prev"),
          a = e._a;
        return a && a.src && !a.paused && S.cmd && S.cmd.kind === "aud" ? { i: e._i || 0, time: a.currentTime } : null;
      })(),
    });
  tx("readonly", (s) => s.get(d.id))
    .then((r) => sendPop({ t: "media", id: d.id, blob: r ? r.blob : null }))
    .catch(() => sendPop({ t: "media", id: d.id, blob: null }));
});
const done = (ts) => {
  if (LIVE) {
    try {
      ch && ch.postMessage({ t: "ended", ts });
    } catch (e) {}
    try {
      window.opener && window.opener.postMessage({ t: "ended", ts }, TO);
    } catch (e) {}
  } else handleEnded(ts);
};
let lastEnded = 0;
const handleEnded = (ts) => {
  if (ts === lastEnded) return;
  lastEnded = ts;
  const g = S.segs[S.seg];
  if (S.cmd && (S.cmd.ts === ts || S.cmd.orig === ts) && S.running && g && g.an && S.seg < S.segs.length - 1)
    setSeg(S.seg + 1);
};
function doAct(a) {
  if (a === "closeWheel") {
    S.scene = "standby";
    S.raffle = null;
    if (rafOn()) S.cmd = { ts: Date.now(), kind: "aud", action: "stop", ids: [] };
  } else if (a === "closeWinner") {
    S.raffle = null;
  } else if (a === "closeAward") {
    S.spot = -1;
    S.spotList = null;
  }
  save();
}
function act(a) {
  if (LIVE) {
    try {
      window.opener && window.opener.postMessage({ t: "act", a }, TO);
    } catch (e) {}
    try {
      ch && ch.postMessage({ t: "act", a });
    } catch (e) {}
  } else doAct(a);
}

export { LIVE, MINE, ch, master, ownOut, sendPop, flush, pending, quiet, save, popOut, done, handleEnded, doAct, act };
