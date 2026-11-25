/**
 * Media library: every song, video, photo and sound effect is uploaded once here and stored once.
 * The segment editor only picks from it (by id), so reusing a file costs no extra space.
 * Also renders the sound-effects board.
 */
import BUNDLED from "../../data/mediaManifest.json";
import { $, esc, MB } from "../constants.js";
import { S } from "../state.js";
import { save } from "../sync.js";
import { tx, url, uploadToLib } from "../media.js";
import { playSfx } from "../actions.js";
import { xon } from "./select.js";

export const KINDS = {
  aud: { icon: "🎵", label: "Music", accept: "audio/*,video/mp4,.mp3,.m4a,.wav,.mp4" },
  vid: { icon: "🎬", label: "Videos", accept: "video/*" },
  img: { icon: "🖼", label: "Photos", accept: "image/*" },
  sfx: { icon: "🔊", label: "Sound effects", accept: "audio/*,.mp3,.m4a,.wav,.ogg" },
};
// Sound effects are pressed by hand on the Sound effects board, never put in a segment, so they are not a library tab
const TABS = ["aud", "vid", "img"];

let tab = "aud";
let preview = null; // { id, audio } - listening on this computer only

export const libItems = (kind) => S.lib.filter((m) => m.kind === kind);
export const libItem = (id) => S.lib.find((m) => m.id === id);
const usage = (id) => S.segs.filter((g) => g.aud.includes(id) || g.vid.includes(id) || g.img.includes(id)).length;
const bare = (name) => name.replace(/\.[^.]+$/, "");

/** delete one or more files from the library (and from every segment that uses them) */
function removeFromLib(...ids) {
  const gone = new Set(ids);
  if (!gone.size) return;
  S.lib = S.lib.filter((m) => !gone.has(m.id));
  for (const g of S.segs) for (const k of ["aud", "vid", "img"]) g[k] = g[k].filter((x) => !gone.has(x));
  if (gone.has(S.bgId)) S.bgId = "";
  for (const id of gone) {
    if (preview && preview.id === id) stopPreview();
    if (!BUNDLED[id]) tx("readwrite", (s) => s.delete(id)).catch(() => {});
    pick.delete(id);
  }
  save();
}

/* ---------- select several files to delete at once ----------
 * "☑ Select" turns on checkboxes for the open list (a library tab, or the sound effects board);
 * "🗑 Delete selected" removes all the ticked files after one confirmation. */
let picking = ""; // "" | a library tab key | "sfx"
const pick = new Set(); // ids ticked
function startPick(where) {
  picking = picking === where ? "" : where;
  pick.clear();
}
/** the bar above a list: Select, or (while selecting) Select all / Delete selected / Cancel */
function pickBar(where, items, noun) {
  if (!items.length) return "";
  if (picking !== where)
    return `<div class="row pickbar"><button data-pk="${where}" title="Tick several ${noun} and delete them together">☑ Select</button></div>`;
  const all = items.every((m) => pick.has(m.id)),
    n = items.filter((m) => pick.has(m.id)).length;
  return `<div class="row pickbar on"><label class="mut"><input type="checkbox" data-pkall="1" ${all ? "checked" : ""}> Select all (${items.length})</label><span class="g mut">${n} selected</span><button class="d" data-pkdel="1" ${n ? "" : "disabled"}>🗑 Delete selected${n ? " (" + n + ")" : ""}</button><button data-pk="${where}">Cancel</button></div>`;
}
/** wire the selection bar and checkboxes of one list */
function pickWire(box, where, items, redraw) {
  box.querySelectorAll("[data-pk]").forEach(
    (b) =>
      (b.onclick = () => {
        startPick(where);
        redraw();
      }),
  );
  const all = box.querySelector("[data-pkall]");
  if (all)
    all.onchange = () => {
      if (all.checked) items.forEach((m) => pick.add(m.id));
      else pick.clear();
      redraw();
    };
  box.querySelectorAll("[data-pkid]").forEach(
    (c) =>
      (c.onchange = () => {
        if (c.checked) pick.add(c.dataset.pkid);
        else pick.delete(c.dataset.pkid);
        redraw();
      }),
  );
  const del = box.querySelector("[data-pkdel]");
  if (del)
    del.onclick = () => {
      const ids = items.filter((m) => pick.has(m.id)).map((m) => m.id);
      if (!ids.length) return;
      const used = ids.filter((id) => usage(id)).length;
      if (
        !confirm(
          `Delete ${ids.length} file${ids.length > 1 ? "s" : ""} from the library?` +
            (used ? ` ${used} of them ${used > 1 ? "are" : "is"} used in segments and will be removed from them.` : ""),
        )
      )
        return;
      picking = "";
      removeFromLib(...ids);
    };
}
const tick = (where, id) => (picking === where ? `<input type="checkbox" class="pkc" data-pkid="${esc(id)}" ${pick.has(id) ? "checked" : ""} aria-label="Select">` : "");

function stopPreview() {
  if (preview) preview.audio.pause();
  preview = null;
}

export function renderLibrary(r) {
  const box = $(r, "#lib"),
    items = libItems(tab),
    total = S.lib.reduce((a, m) => a + (m.size || 0), 0),
    k = KINDS[tab];
  const rows = items
    .map((m) => {
      const n = usage(m.id),
        used = " · " + (n ? "used in " + n + " segment" + (n > 1 ? "s" : "") : "not used yet"),
        thumb = m.kind === "img" ? `<img class="lth" data-lu="${esc(m.id)}" alt="">` : KINDS[m.kind].icon,
        listen =
          m.kind === "aud"
            ? `<button data-lpv="${esc(m.id)}" title="Listen on this computer only">${preview && preview.id === m.id ? "⏹" : "🎧"}</button>`
            : "";
      if (picking === tab)
        return `<label class="row seg pkrow${pick.has(m.id) ? " xon" : ""}">${tick(tab, m.id)}${thumb}<span class="g">${esc(bare(m.name))} <span class="mut">${m.size ? MB(m.size) : ""}${used}</span></span></label>`;
      return `<div class="row seg${xon("lib:" + m.id)}" data-sel="lib:${esc(m.id)}">${thumb}<span class="g">${esc(bare(m.name))} <span class="mut">${m.size ? MB(m.size) : ""}${used}</span></span>${listen}<button class="d xs" data-ldel="${esc(m.id)}" title="Delete from the library">✕</button></div>`;
    })
    .join("");
  const H = `<div class="row">${TABS.map(
    (key) =>
      `<button data-lt="${key}" class="${key === tab ? "on" : ""}">${KINDS[key].icon} ${KINDS[key].label} (${libItems(key).length})</button>`,
  ).join("")}</div>
 <div class="row"><label class="b">⬆ Upload ${k.label.toLowerCase()}<input type="file" hidden multiple accept="${k.accept}" data-lup="${tab}"></label><span class="mut g">Upload each file once, then pick it in any segment.</span></div>
 ${pickBar(tab, items, k.label.toLowerCase())}
 <div class="libl">${rows || `<div class="mut">No ${k.label.toLowerCase()} yet.</div>`}</div>
 <div class="mut" style="margin-top:6px">${S.lib.length} files in the library (sound effects included) · ${MB(total)}</div>`;
  if (box._h !== H) {
    box._h = H;
    box.innerHTML = H;
    box.querySelectorAll("[data-lu]").forEach(async (i) => (i.src = await url(i.dataset.lu)));
  }
  box.querySelectorAll("[data-lt]").forEach(
    (b) =>
      (b.onclick = () => {
        if (tab !== b.dataset.lt) picking = "";
        tab = b.dataset.lt;
        renderLibrary(r);
      }),
  );
  box.querySelectorAll("[data-lpv]").forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.lpv,
          same = preview && preview.id === id;
        stopPreview();
        if (!same) {
          const a = new Audio(await url(id));
          preview = { id, audio: a };
          a.onended = () => {
            preview = null;
            renderLibrary(r);
          };
          a.play().catch(() => {});
        }
        renderLibrary(r);
      }),
  );
  box.querySelectorAll("[data-ldel]").forEach(
    (b) =>
      (b.onclick = () => {
        const m = libItem(b.dataset.ldel),
          n = usage(m.id);
        if (
          confirm(
            `Delete "${bare(m.name)}" from the library?` +
              (n
                ? ` It is used in ${n} segment${n > 1 ? "s" : ""} and will be removed from ${n > 1 ? "them" : "it"}.`
                : ""),
          )
        ) {
          if (preview && preview.id === m.id) stopPreview();
          removeFromLib(m.id);
        }
      }),
  );
  pickWire(box, tab, items, () => renderLibrary(r));
  r.querySelectorAll("[data-lup]").forEach(
    (i) =>
      (i.onchange = () => {
        const fl = [...i.files];
        i.value = "";
        if (fl.length) uploadToLib(i.dataset.lup, fl);
      }),
  );
}

export function renderSfx(r) {
  const box = $(r, "#sfx"),
    fx = libItems("sfx");
  const H = fx.length
    ? pickBar("sfx", fx, "sound effects") +
      fx
        .map((m) =>
          picking === "sfx"
            ? `<label class="sfxw pkrow${pick.has(m.id) ? " xon" : ""}">${tick("sfx", m.id)}<span class="sfxb">🔊 ${esc(bare(m.name))}</span></label>`
            : `<span class="sfxw${xon("fx:" + m.id)}" data-sel="fx:${esc(m.id)}"><button class="sfxb" data-fx="${esc(m.id)}">🔊 ${esc(bare(m.name))}</button><button class="d sfxx xs" data-fxdel="${esc(m.id)}" title="Delete this sound effect">✕</button></span>`,
        )
        .join("")
    : '<div class="mut">No sound effects yet. Upload them with ⬆ Upload effects.</div>';
  if (box._h !== H) {
    box._h = H;
    box.innerHTML = H;
  }
  box.querySelectorAll("[data-fx]").forEach((b) => (b.onclick = () => playSfx(b.dataset.fx)));
  box.querySelectorAll("[data-fxdel]").forEach(
    (b) =>
      (b.onclick = () => {
        const m = libItem(b.dataset.fxdel);
        if (m && confirm(`Delete the sound effect "${bare(m.name)}"?`)) removeFromLib(m.id);
      }),
  );
  pickWire(box, "sfx", fx, () => renderSfx(r));
}
