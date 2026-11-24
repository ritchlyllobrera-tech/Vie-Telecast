/** Show actions: go to a segment, send a playback command, spin the raffle. */
import { AUTO } from "./constants.js";
import { S, dedupe } from "./state.js";
import { save } from "./sync.js";
import { startRaf, rafOn } from "./playback.js";
import { now } from "./clock.js";

/* actions */
function setSeg(i) {
  const g = S.segs[i];
  S.seg = S.edit = i;
  S.running = true;
  S.pausedLeft = null;
  S.segStart = now();
  S.spot = -1;
  S.bgId = "";
  if (!S.started) {
    S.started = 1;
    S.t0 = now();
  }
  if (S.auto) S.scene = AUTO[g.id] && AUTO[g.id] !== "spin-wheel" ? AUTO[g.id] : "standby";
  {
    const A = [...g.aud],
      V = g.vid[0],
      ts = Date.now();
    if (g.av && V) {
      S.scene = "segment-video";
      S.cmd = { ts, kind: "vid", action: "play", ids: [V] };
    } else if (A.length && g.am !== false) {
      S.cmd = { ts, kind: "aud", action: "play", ids: A, seg: g.id };
    } else if (S.cmd && S.cmd.action !== "stop") S.cmd = { ts, kind: "aud", action: "stop", ids: [] };
  }
  save();
}
/** start = index in `ids` to begin with (▶ on one song plays the rest of the playlist from there) */
const cmd = (kind, action, ids, start) => {
  if (action === "toggle" && S.cmd && S.cmd.kind === kind && S.cmd.action !== "stop") {
    // ⏯ keeps the same playlist alive, so it still moves on to the next song afterwards
    S.cmd = { ...S.cmd, ts: Date.now(), action: "toggle", orig: S.cmd.orig || S.cmd.ts };
    save();
    return;
  }
  S.cmd = { ts: Date.now(), kind, action, ids: ids || [], seg: S.segs[S.edit].id, start: start || 0 };
  if (action === "play" && kind === "vid") S.scene = "segment-video";
  if (action === "stop" && S.scene === "segment-video") S.scene = "standby";
  save();
};
function spin() {
  if (S.raffle && now() - S.raffle.spinId < (S.raffle.dur || 10) * 1000 + 1000) return;
  const n = dedupe(S.pool);
  if (!n.length) {
    alert("Paste at least one participant first.");
    return;
  }
  const w = n[Math.floor(Math.random() * n.length)];
  const pz = (S.prize || "").trim(),
    dur = +S.spinSec || [10, 15, 20, 25, 30][Math.floor(Math.random() * 5)];
  S.winners.push({ name: w, prize: pz });
  S.raffle = { names: n, winner: w, spinId: now(), prize: pz, round: S.winners.length, dur };
  S.scene = "spin-wheel";
  if (!rafOn()) startRaf();
  S.pool = n.filter((x) => x !== w).join("\n");
  save();
}

/* ---------- director's Start / Pause / Resume ---------- */
const playing = () => S.cmd && ["play", "resume", "toggle"].includes(S.cmd.action);
/** Freeze the segment timer and pause the music/video (Auto-Pilot also waits). */
function pauseShow(onOpen) {
  if (S.running) {
    const g = S.segs[S.seg],
      left = S.segStart + g.min * 60000 - now();
    // on (re)opening a stale save the time has run out - give the segment its full time back
    S.pausedLeft = onOpen && left <= 0 ? g.min * 60000 : left;
    S.running = false;
  }
  if (playing()) S.cmd = { ...S.cmd, ts: Date.now(), action: "pause", orig: S.cmd.orig || S.cmd.ts };
  save();
}
/** Start the show (segment 1) or continue where it was paused. */
function resumeShow() {
  if (!S.started) return setSeg(0);
  const g = S.segs[S.seg],
    left = S.pausedLeft ?? g.min * 60000;
  S.segStart = now() - (g.min * 60000 - left);
  S.running = true;
  S.pausedLeft = null;
  if (S.cmd && S.cmd.action === "pause") S.cmd = { ...S.cmd, ts: Date.now(), action: "resume" };
  save();
}
function restartShow() {
  S.started = 0;
  setSeg(0);
}
/** Opening the control room never starts (or continues) the program by itself. */
function holdOnOpen() {
  if (S.running || playing()) pauseShow(true);
}

/** Sound effects play once on the live screen, layered over whatever is playing. */
const playSfx = (id) => {
  S.sfx = { id, ts: Date.now() };
  save();
};
const stopSfx = () => {
  S.sfx = { id: "", ts: Date.now() };
  save();
};

export { setSeg, cmd, spin, playSfx, stopSfx, pauseShow, resumeShow, restartShow, holdOnOpen };
