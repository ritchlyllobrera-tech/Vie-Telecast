/**
 * "Change media in many segments": add, replace or remove music / videos / photos in many segments at once,
 * e.g. the same song in the segments of all three locations. Only segments this computer may edit are
 * offered (the Director: all; an Editor: their location's and the shared ones). One save sends every
 * changed segment, so all locations get it together. Undo puts the lists back as they were.
 */
import { esc, LOCS } from "../constants.js";
import { S } from "../state.js";
import { save } from "../sync.js";
import { NET, canEditSeg } from "../net.js";
import { libItems } from "./library.js";

const KINDS = { aud: "🎵 Music", vid: "🎬 Videos", img: "🖼 Photos" };
const MAX_IMG = 6; // same limit as the Segment editor
const bare = (n) => String(n || "").replace(/\.[^.]+$/, "");
const locName = (k) => (k ? LOCS[k] || k : "All locations");

let st = null; // dialog state while it is open
let undo = null; // { kind, before: [{ id, list }], msg }

export function openBulk() {
  const locs = new Set(["", ...Object.keys(LOCS)]);
  st = { kind: "aud", act: "add", picks: new Set(), from: "", to: "", locs, segs: new Set(), msg: "" };
  editable().forEach((g) => st.segs.add(g.id)); // all ticked to start with
  draw();
}

const editable = () => S.segs.filter((g) => canEditSeg(g));
const ticked = () => editable().filter((g) => st.segs.has(g.id));

/** the segments the chosen action would really change */
function affected() {
  const k = st.kind;
  return ticked().filter((g) => {
    const l = g[k] || [];
    if (st.act === "add") return [...st.picks].some((id) => !l.includes(id)) && (k !== "img" || l.length < MAX_IMG);
    if (st.act === "replace") return !!st.from && !!st.to && st.from !== st.to && l.includes(st.from);
    return !!st.from && l.includes(st.from);
  });
}

function apply() {
  const k = st.kind,
    list = affected();
  if (!list.length) return;
  const before = list.map((g) => ({ id: g.id, list: [...g[k]] }));
  for (const g of list) {
    let l = [...g[k]];
    if (st.act === "add") {
      for (const id of st.picks) if (!l.includes(id) && (k !== "img" || l.length < MAX_IMG)) l.push(id);
    } else if (st.act === "replace") {
      // keep its place in the playlist; if the new one is already there, just drop the old one
      l = l.includes(st.to) ? l.filter((x) => x !== st.from) : l.map((x) => (x === st.from ? st.to : x));
    } else l = l.filter((x) => x !== st.from);
    g[k] = l;
  }
  // count per location for the message
  const per = {};
  list.forEach((g) => (per[locName(g.loc)] = (per[locName(g.loc)] || 0) + 1));
  const msg =
    `✔ Changed ${list.length} segment${list.length > 1 ? "s" : ""}` +
    (NET.on ? " (" + Object.entries(per).map(([n, c]) => n + " " + c).join(", ") + "). Every location has it now." : ".");
  undo = { kind: k, before, msg };
  st.msg = msg;
  st.picks.clear();
  save();
  draw();
}

function doUndo() {
  if (!undo) return;
  for (const b of undo.before) {
    const g = S.segs.find((x) => x.id === b.id);
    if (g && canEditSeg(g)) g[undo.kind] = b.list;
  }
  st.msg = "↩ Undone: the segments have their media back as before.";
  undo = null;
  save();
  draw();
}

function draw() {
  let d = document.getElementById("bulk");
  if (!st) return d && d.remove();
  if (!d) {
    d = document.createElement("div");
    d.id = "bulk";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", "Change media in many segments");
    document.body.appendChild(d);
    d.onclick = (e) => e.target === d && close();
  }
  const k = st.kind,
    lib = libItems(k),
    segs = editable(),
    // replace / remove: only what the ticked segments actually use
    used = lib.filter((m) => ticked().some((g) => (g[k] || []).includes(m.id))),
    aff = affected(),
    nUse = (id) => ticked().filter((g) => (g[k] || []).includes(id)).length,
    opt = (m, sel, n) => `<option value="${esc(m.id)}" ${sel === m.id ? "selected" : ""}>${esc(bare(m.name))}${n ? " · in " + n + " segment" + (n > 1 ? "s" : "") : ""}</option>`;
  const what =
    st.act === "add"
      ? `<div class="bpk">${lib.length ? lib.map((m) => `<label class="pki${st.picks.has(m.id) ? " on" : ""}"><input type="checkbox" data-pk="${esc(m.id)}" ${st.picks.has(m.id) ? "checked" : ""}> <span class="g">${esc(bare(m.name))}</span></label>`).join("") : '<div class="mut">Nothing of this kind in the Media library yet.</div>'}</div>`
      : `<div class="row"><select data-from class="g"><option value="">${st.act === "replace" ? "Replace…" : "Remove…"}</option>${used.map((m) => opt(m, st.from, nUse(m.id))).join("")}</select>${
          st.act === "replace"
            ? `<span>with</span><select data-to class="g"><option value="">…choose the new one</option>${lib.filter((m) => m.id !== st.from).map((m) => opt(m, st.to)).join("")}</select>`
            : ""
        }</div>${used.length ? "" : '<div class="mut">The ticked segments have none of these.</div>'}`;
  const locRow = NET.on
    ? `<div class="row">${["", ...Object.keys(LOCS)]
        .filter((l) => segs.some((g) => (g.loc || "") === l))
        .map((l) => `<label class="locc${l ? " l-" + l : " all"}"><input type="checkbox" data-loc="${l}" ${st.locs.has(l) ? "checked" : ""}> ${l ? "📍 " + esc(LOCS[l]) : "🌐 All locations"}</label>`)
        .join("")}</div>`
    : "";
  // keep the lists where they were scrolled to (the dialog is redrawn after every click)
  const sc = [...d.querySelectorAll(".bsl, .bpk, .cc")].map((x) => x.scrollTop);
  d.innerHTML = `<div class="cc"><h3>🔁 Change media in many segments</h3>
 <div class="row"><label class="mut">Media <select data-kind>${Object.entries(KINDS).map(([v, t]) => `<option value="${v}" ${k === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
 <label class="mut">Do <select data-act><option value="add" ${st.act === "add" ? "selected" : ""}>＋ Add to the segments</option><option value="replace" ${st.act === "replace" ? "selected" : ""}>⇄ Replace one with another</option><option value="remove" ${st.act === "remove" ? "selected" : ""}>✕ Remove from the segments</option></select></label></div>
 ${what}
 <h4>In which segments</h4>${locRow}
 <div class="bsl">${segs
   .map((g) => {
     const i = S.segs.indexOf(g),
       hit = aff.includes(g);
     return `<label class="row bsr${hit ? " hit" : ""}"><input type="checkbox" data-seg="${esc(g.id)}" ${st.segs.has(g.id) ? "checked" : ""}><span class="g">${i + 1}. ${esc(g.title)}</span>${NET.on ? `<span class="mut">${esc(locName(g.loc))}</span>` : ""}<span class="mut">${(g[k] || []).length} ${k === "aud" ? "songs" : k === "vid" ? "videos" : "photos"}</span>${hit ? '<b class="okc">will change</b>' : ""}</label>`;
   })
   .join("")}</div>
 ${st.msg ? `<div class="bmsg">${esc(st.msg)}</div>` : ""}
 <div class="row" style="justify-content:flex-end">${undo ? '<button data-undo>↩ Undo last change</button>' : ""}<button data-x>Close</button><button class="p" data-go ${aff.length ? "" : "disabled"}>Apply to ${aff.length} segment${aff.length === 1 ? "" : "s"}</button></div></div>`;

  d.querySelectorAll(".bsl, .bpk, .cc").forEach((x, i) => (x.scrollTop = sc[i] || 0));
  const on = (sel, ev, f) => d.querySelectorAll(sel).forEach((x) => (x[ev] = () => f(x)));
  on("[data-kind]", "onchange", (x) => {
    st.kind = x.value;
    st.picks.clear();
    st.from = st.to = "";
    st.msg = "";
    draw();
  });
  on("[data-act]", "onchange", (x) => {
    st.act = x.value;
    st.from = st.to = "";
    st.msg = "";
    draw();
  });
  on("[data-pk]", "onchange", (x) => {
    x.checked ? st.picks.add(x.dataset.pk) : st.picks.delete(x.dataset.pk);
    st.msg = "";
    draw();
  });
  on("[data-from]", "onchange", (x) => {
    st.from = x.value;
    st.msg = "";
    draw();
  });
  on("[data-to]", "onchange", (x) => {
    st.to = x.value;
    st.msg = "";
    draw();
  });
  on("[data-loc]", "onchange", (x) => {
    const l = x.dataset.loc;
    x.checked ? st.locs.add(l) : st.locs.delete(l);
    // a location's tick ticks / unticks all its segments
    segs.filter((g) => (g.loc || "") === l).forEach((g) => (x.checked ? st.segs.add(g.id) : st.segs.delete(g.id)));
    draw();
  });
  on("[data-seg]", "onchange", (x) => {
    x.checked ? st.segs.add(x.dataset.seg) : st.segs.delete(x.dataset.seg);
    draw();
  });
  on("[data-go]", "onclick", apply);
  on("[data-undo]", "onclick", doUndo);
  on("[data-x]", "onclick", close);
}
function close() {
  st = null;
  draw();
}
/** keep the open dialog in step when someone else changes the rundown or the library */
export function refreshBulk() {
  if (!st) return;
  const d = document.getElementById("bulk");
  if (d && d.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  const key = JSON.stringify([S.segs.map((g) => [g.id, g.title, g.loc, g[st.kind]]), S.lib.length]);
  if (key !== st.key) {
    st.key = key;
    draw();
  }
}
