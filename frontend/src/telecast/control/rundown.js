/** Rundown list (card 1), plus inserting and deleting segments. */
import { $, esc, LOCS } from "../constants.js";
import { S } from "../state.js";
import { save } from "../sync.js";
import { setSeg } from "../actions.js";
import { NET, canControl, canEditSeg, myLoc } from "../net.js";

// "Only my location" filter: a per-computer view setting
const MK = "vtc_rd_mine";
let onlyMine = false;
try {
  onlyMine = localStorage.getItem(MK) === "1";
} catch {
  /* storage blocked */
}
const SHORT = { cebu: "Cebu", ncr: "NCR", cdo: "CDO" };
/** small location tag for a rundown row */
const locChip = (g) =>
  g.loc && LOCS[g.loc]
    ? `<span class="locc l-${g.loc}${g.loc === myLoc() ? " me" : ""}" title="Belongs to ${esc(LOCS[g.loc])}">📍 ${esc(SHORT[g.loc] || LOCS[g.loc])}</span>`
    : `<span class="locc all" title="Shared by all locations">🌐 All</span>`;

/** "14:30" + 30 min -> "15:00" (empty when there is no start time to count from) */
function addTime(t, min) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return "";
  const x = (((+m[1] * 60 + +m[2] + Math.round(min || 0)) % 1440) + 1440) % 1440;
  return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
}

/** Insert a new segment after the segment with id `after` ("" = at the top, "end" = at the bottom) and open it in the Segment editor. */
export function addSeg(after) {
  // by id, not position: someone else may have inserted a segment since the list was drawn
  const at = after === "end" ? S.segs.length : after ? S.segs.findIndex((g) => g.id === after) + 1 : 0;
  if (after && after !== "end" && at === 0) return; // that segment was deleted meanwhile
  document.activeElement?.blur?.(); // the editor does not redraw while one of its fields has the focus
  const prev = S.segs[at - 1];
  S.segs.splice(at, 0, {
    id: "seg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: "New segment",
    min: 10,
    desc: "",
    time: prev ? addTime(prev.time, prev.min) : "",
    av: false,
    bg: null,
    wheel: false,
    aud: [],
    vid: [],
    img: [],
    // an Editor's new segment belongs to their location; the Director's is shared by all
    loc: NET.on && !canControl() ? myLoc() : "",
  });
  // segments are counted by position: whatever was at `at` or later moves down by one
  if (at <= S.seg) S.seg++;
  S.edit = at;
  save();
  setTimeout(() => {
    const t = document.querySelector('#ed [data-f="title"]');
    if (t) {
      t.focus();
      t.select();
    }
  }, 50);
}

/** Delete segment `i` (never the last remaining one, nor the one on air). */
export function delSeg(i) {
  if (S.segs.length <= 1 || (i === S.seg && S.started) || !canEditSeg(S.segs[i])) return;
  S.segs.splice(i, 1);
  if (i < S.seg) S.seg--;
  S.seg = Math.min(S.seg, S.segs.length - 1);
  if (i < S.edit || S.edit >= S.segs.length) S.edit = Math.max(0, S.edit - 1);
  save();
}

function renderRundown(r) {
  const locs = NET.on && LOCS[myLoc()],
    mineOnly = locs && onlyMine,
    rd = $(r, "#rd"),
    ins = (after) =>
      mineOnly
        ? "" // inserting between hidden rows would be confusing: use "＋ Add segment" at the bottom
        : `<button class="ins" data-ins="${after}" title="Insert a new segment here" aria-label="Insert a new segment here">＋</button>`,
    H =
      (locs
        ? `<div class="row rdloc"><span class="mut">📍 You: <b>${esc(LOCS[myLoc()])}</b></span><label class="mut"><input type="checkbox" data-mine ${onlyMine ? "checked" : ""}> Only my location's segments</label></div>`
        : "") +
      ins("") +
      S.segs
        .map((g, i) =>
          mineOnly && g.loc !== myLoc() && i !== S.seg
            ? "" // hidden by the filter (the segment on air always stays visible)
            : `<div class="row seg ${i === S.seg ? "act" : ""} ${i === S.edit ? "ed" : ""} ${locs && g.loc === myLoc() ? "mine" : ""}"><span class="tm">${g.time || "--:--"}</span><b class="g">${i + 1}. ${esc(g.title)}</b>${locs ? locChip(g) : ""}<span class="mut" title="${g.endAct === "next" ? "Goes to the next segment by itself when its time is up" : "Asks when its time is up"}">${g.min}m${g.endAct === "next" ? " ⏭" : ""}</span><button data-ed="${i}" title="${canEditSeg(g) ? "Edit this segment" : "View this segment (it belongs to " + esc(LOCS[g.loc] || g.loc) + ")"}">${canEditSeg(g) ? "✎" : "🔒"}</button><button data-go="${i}" class="${i === S.seg ? "p" : ""}" title="Take this segment live">▶</button></div>` +
              ins(g.id),
        )
        .join("") +
      (mineOnly && !S.segs.some((g) => g.loc === myLoc())
        ? `<div class="mut" style="padding:6px">No segments belong to ${esc(LOCS[myLoc()])} yet. Open a segment and set “Belongs to”, or add one below.</div>`
        : "") +
      `<button class="addseg" data-ins="end">＋ Add segment${locs && !canControl() ? " for " + esc(LOCS[myLoc()]) : ""}</button>`;
  if (rd._h !== H) {
    rd._h = H;
    rd.innerHTML = H;
  }
  const mc = rd.querySelector("[data-mine]");
  if (mc)
    mc.onchange = () => {
      onlyMine = mc.checked;
      try {
        localStorage.setItem(MK, onlyMine ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      renderRundown(r);
    };
  r.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => setSeg(+b.dataset.go)));
  r.querySelectorAll("[data-ins]").forEach((b) => (b.onclick = () => addSeg(b.dataset.ins)));
  r.querySelectorAll("[data-ed]").forEach(
    (b) =>
      (b.onclick = () => {
        document.activeElement?.blur?.(); // the editor does not redraw while one of its fields has the focus
        S.edit = +b.dataset.ed;
        save();
      }),
  );
}

export { renderRundown };
