/** The single show state object `S` (persisted to localStorage) and helpers that normalise it. */
import BUNDLED from "../data/mediaManifest.json";
import { K, DEF, norm, ytId } from "./constants.js";
import { now } from "./clock.js";

let S;
try {
  S = { ...DEF, ...JSON.parse(localStorage.getItem(K)) };
} catch (e) {
  S = { ...DEF };
}
fixSegs();
function fixSegs() {
  S.segs = S.segs.map((g) => ({ desc: "", time: "", av: false, bg: null, ...g }));
  S.segs.forEach((g) => {
    if (g.wheel === undefined) g.wheel = /raffle|wheel|stars of the night/i.test(g.title);
  });
  if (!S.lib) migrateToLibrary();
  delete S.media;
  for (const g of S.segs) for (const k of ["aud", "vid", "img"]) g[k] = g[k] || [];
}
/**
 * Older saves kept one upload per segment in S.media (the same song uploaded twice = two files).
 * Move them into the shared library S.lib (one entry per distinct file) and give every
 * segment ordered lists of library ids: g.aud, g.vid, g.img.
 */
function migrateToLibrary() {
  S.lib = [];
  const canon = {},
    alias = {};
  for (const m of S.media || []) {
    const b = BUNDLED[m.id],
      key = m.kind + "|" + (b ? b.url : m.name + "|" + (m.size || ""));
    if (!canon[key]) {
      canon[key] = m.id;
      S.lib.push({ id: m.id, kind: m.kind, name: m.name, size: m.size || (b && b.size) || 0 });
    }
    const id = (alias[m.id] = canon[key]),
      g = S.segs.find((s) => s.id === m.seg);
    if (g) {
      g[m.kind] = g[m.kind] || [];
      if (!g[m.kind].includes(id)) g[m.kind].push(id);
    }
  }
  if (alias[S.bgId]) S.bgId = alias[S.bgId];
  if (S.cmd && S.cmd.ids) S.cmd.ids = S.cmd.ids.map((id) => alias[id] || id);
}
function dedupe(t) {
  const seen = new Set(),
    o = [],
    W = new Set((S.winners || []).map((w) => norm(w.name)));
  for (const l of t.split(/\r?\n/)) {
    const x = l.trim().replace(/\s+/g, " ");
    if (x && !seen.has(norm(x)) && !W.has(norm(x))) {
      seen.add(norm(x));
      o.push(x);
    }
  }
  return o;
}
/** ms left in the current segment (frozen while the show is paused / not started). */
export function segLeft() {
  const g = S.segs[S.seg] || S.segs[0];
  return S.running ? S.segStart + g.min * 60000 - now() : (S.pausedLeft ?? g.min * 60000);
}
export function setS(v) {
  S = v;
}

/** The YouTube Live video id of a segment: its own link field, or an older Live-call entry set to YouTube ("" = none). */
const segYt = (g) => ytId(g && g.yt) || (g && g.call && g.call.platform === "youtube" ? ytId(g.call.link) : "");
/** YouTube Live is playing on the screens: started for the segment that is on air now (any other segment stops it). */
const ytOn = () => !!(S.yt && S.yt.id && S.segs[S.seg] && S.yt.seg === S.segs[S.seg].id);
export { S, fixSegs, dedupe, segYt, ytOn };
