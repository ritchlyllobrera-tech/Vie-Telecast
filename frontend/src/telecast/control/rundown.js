/** Rundown list (card 1), plus inserting and deleting segments. */
import { $, esc, LOCS } from "../constants.js";
import { S, segYt } from "../state.js";
import { save } from "../sync.js";
import { setSeg, setAll } from "../actions.js";
import { setDrawer } from "./editor.js";
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
  setDrawer(true);
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

/**
 * Drag a row by its ⠿ handle (pointer events: mouse and touch). `to` = the index the row is dropped BEFORE (n = at the end).
 * The segment on air and the one being edited are followed by id (S.seg / S.edit are positions). Start times are then
 * recounted for the segments this person may edit and can see: the first keeps its time, each next = previous + its length.
 */
let dragging = false,
  focusIdx = -1;
export function moveSeg(from, to) {
  const g = S.segs[from];
  if (!g || !canEditSeg(g) || to === from || to === from + 1) return;
  const onId = (S.segs[S.seg] || {}).id,
    edId = (S.segs[S.edit] || {}).id;
  const mineOnly = NET.on && LOCS[myLoc()] && onlyMine,
    inScope = (x) => canEditSeg(x) && (!mineOnly || x.loc === myLoc()),
    t0 = (S.segs.find(inScope) || {}).time; // the first slot keeps its start time
  S.segs.splice(from, 1);
  S.segs.splice(to > from ? to - 1 : to, 0, g);
  S.seg = Math.max(0, S.segs.findIndex((x) => x.id === onId));
  S.edit = Math.max(0, S.segs.findIndex((x) => x.id === edId));
  const scope = S.segs.filter(inScope);
  if (scope[0] && t0) scope[0].time = t0;
  for (let k = 1; k < scope.length; k++) {
    const t = addTime(scope[k - 1].time, scope[k - 1].min);
    if (t) scope[k].time = t;
  }
  save();
}
/**
 * Drag a row (by its ⠿ handle, or with the mouse by the row itself) and drop it
 *   - on the LIST: reorder (only for segments this person may edit),
 *   - on the MONITOR (the card with the video screen): play it, exactly like its ▶ (setSeg),
 *   - anywhere else, or Esc: nothing.
 */
const zone = () => {
  let z = document.getElementById("dropz");
  if (!z) {
    z = document.createElement("div");
    z.id = "dropz";
    document.body.appendChild(z);
  }
  return z;
};
function startDrag(e, src, r, lazy) {
  if (e.button > 0) return;
  const rd = $(r, "#rd"),
    row = src.closest(".row.seg"),
    from = +row.querySelector("[data-drag]").dataset.drag,
    g = S.segs[from],
    rows = () => [...rd.querySelectorAll(".row.seg")],
    card = $(r, "#prev").closest("section"),
    inside = (q, ev) => ev.clientX >= q.left && ev.clientX <= q.right && ev.clientY >= q.top && ev.clientY <= q.bottom,
    label = () =>
      !canControl()
        ? "Drop to play on my screen"
        : NET.on
          ? g.all
            ? "Drop to play on ALL sites"
            : `Drop to play at ${LOCS[myLoc()] || "Cebu"}`
          : "Drop to play here";
  let live = false,
    to = -1,
    play = false,
    ghost = null;
  const clear = () => {
    rows().forEach((x) => x.classList.remove("dropb", "dropa"));
    zone().classList.remove("on");
  };
  const over = (ev) => {
    lastEv = ev;
    clear();
    to = -1;
    play = false;
    ghost.style.left = ev.clientX + 12 + "px";
    ghost.style.top = ev.clientY + 8 + "px";
    if (inside(card.getBoundingClientRect(), ev)) {
      const q = $(r, "#prev").getBoundingClientRect(),
        z = zone();
      play = true;
      z.textContent = "▶ " + label();
      z.style.cssText = `left:${q.left}px;top:${q.top}px;width:${q.width}px;height:${q.height}px`;
      z.classList.add("on");
      return;
    }
    if (!canEditSeg(g)) return; // may be played, not reordered
    const hit = rows().find((x) => {
      const q = x.getBoundingClientRect();
      return ev.clientY >= q.top && ev.clientY < q.bottom && ev.clientX >= q.left && ev.clientX <= q.right;
    });
    if (!hit) return;
    const q = hit.getBoundingClientRect(),
      i = +hit.querySelector("[data-drag]").dataset.drag,
      below = ev.clientY > (q.top + q.bottom) / 2;
    to = below ? i + 1 : i;
    hit.classList.add(below ? "dropa" : "dropb");
  };
  let lastEv = null;
  const autoScroll = () => {
    if (!live) return;
    const sc = sideScroller(r),
      Y = lastEv ? lastEv.clientY : -1,
      q = sc ? sc.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight },
      Z = 70;
    if (lastEv && lastEv.clientX >= q.left && lastEv.clientX <= q.right) {
      const d = Y < q.top + Z ? -(q.top + Z - Y) : Y > q.bottom - Z ? Y - (q.bottom - Z) : 0,
        v = Math.max(-24, Math.min(24, d / 3));
      if (v) {
        if (sc) sc.scrollTop += v;
        else scrollBy(0, v);
        over(lastEv);
      }
    }
    requestAnimationFrame(autoScroll);
  };
  const begin = () => {
    live = true;
    requestAnimationFrame(autoScroll);
    dragging = true;
    ghost = document.createElement("div");
    ghost.className = "dghost";
    ghost.textContent = "⠿ " + g.title;
    document.body.appendChild(ghost);
    row.classList.add("dragging");
    document.body.classList.add("dnd");
  };
  const finish = (act, ev) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
    if (!live) return;
    if (act === "drop" && ev) over(ev);
    const doPlay = act === "drop" && play,
      doMove = act === "drop" && !play && to >= 0;
    ghost.remove();
    clear();
    row.classList.remove("dragging");
    document.body.classList.remove("dnd");
    dragging = false;
    if (doPlay) setSeg(from);
    else if (doMove) moveSeg(from, to);
    renderRundown(r);
  };
  const x0 = e.clientX,
    y0 = e.clientY,
    move = (ev) => {
      if (!live) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        begin();
      }
      over(ev);
    },
    up = (ev) => finish("drop", ev),
    cancel = () => finish("cancel"),
    key = (ev) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      finish("cancel");
    };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key, true);
  if (!lazy) {
    e.preventDefault();
    begin();
    over(e);
  }
}

/** the element that scrolls the segment list: #rd itself when it scrolls inside the sidebar, else the page (null) */
const sideScroller = (r) => {
  const sd = $(r, "#rd");
  return sd && getComputedStyle(sd).overflowY === "auto" ? sd : null;
};
let shownSeg = -2;
function renderRundown(r) {
  if (dragging) return; // the list must not be rebuilt under the finger
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
            : `<div class="row seg ${i === S.seg ? "act" : ""} ${i === S.edit ? "ed" : ""} ${locs && g.loc === myLoc() ? "mine" : ""}"><button class="dh${canEditSeg(g) ? "" : " lock"}" data-drag="${i}" title="${canEditSeg(g) ? "Drag onto the video screen to play it, or within the list to reorder (Alt+↑ / Alt+↓ on the keyboard)" : "Drag onto the video screen to play it (this segment belongs to " + esc(LOCS[g.loc] || g.loc) + ", so it can't be reordered)"}" aria-label="Reorder segment ${i + 1}">⠿</button><span class="tm">${esc(g.time || "--:--")}</span><b class="g">${i + 1}. ${esc(g.title)}</b><button data-ed="${i}" title="${canEditSeg(g) ? "Edit this segment" : "View this segment (it belongs to " + esc(LOCS[g.loc] || g.loc) + ")"}">${canEditSeg(g) ? "✎" : "🔒"}</button><button data-go="${i}" class="${i === S.seg ? "p" : ""}" title="Take this segment live">▶</button><div class="rl2">${segYt(g) ? `<span class="ytchip" title="Plays YouTube Live on the screens when this segment starts">📺 LIVE</span>` : ""}${locs ? locChip(g) : ""}<span class="mut" title="${g.endAct === "next" ? "Goes to the next segment by itself when its time is up" : "Asks when its time is up"}">${esc(g.min)}m${g.endAct === "next" ? " ⏭" : ""}</span>${NET.on ? (canControl() ? `<label class="swt${g.all ? " on" : ""}" title="${segYt(g) ? "Live / CEO speech: show it on every site's screen when you press ▶" : "Show this segment on every site's screen when you press ▶"}"><input type="checkbox" data-allr="${i}" ${g.all ? "checked" : ""}><span>📡 All</span></label>` : g.all ? `<span class="allb" title="The Director plays this segment on every site">📡 All</span>` : "") : ""}</div></div>` +
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
  if (shownSeg !== S.seg) {
    // only when the segment on air changes (never fight the user's own scrolling)
    shownSeg = S.seg;
    const sc = sideScroller(r),
      row = rd.querySelector(".row.seg.act");
    if (sc && row) {
      const c = sc.getBoundingClientRect(),
        q = row.getBoundingClientRect();
      if (q.top < c.top + 40 || q.bottom > c.bottom - 8) sc.scrollTop += q.top - c.top - (c.height - q.height) / 2;
    }
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
  r.querySelectorAll("[data-allr]").forEach((b) => (b.onchange = () => setAll(+b.dataset.allr, b.checked)));
  rd.querySelectorAll(".row.seg").forEach(
    (row) =>
      (row.onpointerdown = (e) => {
        if (e.pointerType === "mouse" && !e.target.closest("button,label,input,select,a")) startDrag(e, row, r, true);
      }),
  );
  r.querySelectorAll("[data-drag]").forEach((b) => {
    b.onpointerdown = (e) => startDrag(e, b, r, false);
    b.onkeydown = (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const i = +b.dataset.drag;
      focusIdx = Math.max(0, Math.min(S.segs.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
      moveSeg(i, e.key === "ArrowUp" ? i - 1 : i + 2);
    };
  });
  if (focusIdx >= 0) {
    rd.querySelector(`[data-drag="${focusIdx}"]`)?.focus();
    focusIdx = -1;
  }
  r.querySelectorAll("[data-ins]").forEach((b) => (b.onclick = () => addSeg(b.dataset.ins)));
  r.querySelectorAll("[data-ed]").forEach(
    (b) =>
      (b.onclick = () => {
        document.activeElement?.blur?.(); // the editor does not redraw while one of its fields has the focus
        S.edit = +b.dataset.ed;
        setDrawer(true);
        save();
      }),
  );
}

export { renderRundown };
