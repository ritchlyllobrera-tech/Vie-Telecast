/** The single show state object `S` (persisted to localStorage) and helpers that normalise it. */
import BUNDLED from "../data/mediaManifest.json";
import { K, DEF, norm, ytId, LOCS } from "./constants.js";
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
/** most raffle participants per location */
const MAXN = 250;
/**
 * Clean a raffle names list: one name per line, blank lines dropped, a name repeated (any capitals / spacing)
 * kept once, this location's winners left out, at most MAXN names (the first ones in the list).
 * Returns { names, dup: repeats removed, won: winners left out, over: names past the limit }.
 */
function cleanList(t) {
  const seen = new Set(),
    names = [],
    W = new Set(locWinners().map((w) => norm(w.name)));
  let dup = 0,
    won = 0,
    over = 0;
  for (const l of String(t || "").split(/\r?\n/)) {
    const x = l.trim().replace(/\s+/g, " "),
      k = norm(x);
    if (!x) continue;
    if (seen.has(k)) dup++;
    else {
      seen.add(k);
      if (W.has(k)) won++;
      else if (names.length >= MAXN) over++;
      else names.push(x);
    }
  }
  return { names, dup, won, over };
}
const dedupe = (t) => cleanList(t).names;
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
/** the award shown on the Live Screen for award folder `k` (its own title, else the folder name) */
const awTitle = (k) => (S.awTitle && typeof S.awTitle[k] === "string" && S.awTitle[k].trim()) || k;
/* ---------- grand raffle per location ----------
 * Every location has its own names list, prize and winners. S.rafLoc is the location this computer's raffle
 * runs for: the Director picks it (and their Live screens follow); an Editor's is their own location. */
const rafLoc = () => (S.rafLoc && LOCS[S.rafLoc] ? S.rafLoc : "cebu");
const poolText = () => (S.pools && typeof S.pools[rafLoc()] === "string" ? S.pools[rafLoc()] : "");
const setPool = (t) => (S.pools = { ...(S.pools || {}), [rafLoc()]: t });
const prizeText = () => (S.prizes && typeof S.prizes[rafLoc()] === "string" ? S.prizes[rafLoc()] : "");
const setPrize = (t) => (S.prizes = { ...(S.prizes || {}), [rafLoc()]: t });
/** winners of this computer's raffle location (older winners without a location count as Cebu) */
const locWinners = () => (S.winners || []).filter((w) => (w.loc || "cebu") === rafLoc());
export { S, fixSegs, dedupe, cleanList, MAXN, segYt, ytOn, awTitle, rafLoc, poolText, setPool, prizeText, setPrize, locWinners };
