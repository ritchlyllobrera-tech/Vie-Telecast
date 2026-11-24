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

function removeFromLib(id) {
  S.lib = S.lib.filter((m) => m.id !== id);
  for (const g of S.segs) for (const k of ["aud", "vid", "img"]) g[k] = g[k].filter((x) => x !== id);
  if (S.bgId === id) S.bgId = "";
  if (!BUNDLED[id]) tx("readwrite", (s) => s.delete(id)).catch(() => {});
  save();
}

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
        thumb = m.kind === "img" ? `<img class="lth" data-lu="${m.id}" alt="">` : KINDS[m.kind].icon,
        listen =
          m.kind === "aud"
            ? `<button data-lpv="${m.id}" title="Listen on this computer only">${preview && preview.id === m.id ? "⏹" : "🎧"}</button>`
            : "";
      return `<div class="row seg${xon("lib:" + m.id)}" data-sel="lib:${m.id}">${thumb}<span class="g">${esc(bare(m.name))} <span class="mut">${m.size ? MB(m.size) : ""}${used}</span></span>${listen}<button class="d xs" data-ldel="${m.id}" title="Delete from the library">✕</button></div>`;
    })
    .join("");
  const H = `<div class="row">${TABS.map(
    (key) =>
      `<button data-lt="${key}" class="${key === tab ? "on" : ""}">${KINDS[key].icon} ${KINDS[key].label} (${libItems(key).length})</button>`,
  ).join("")}</div>
 <div class="row"><label class="b">⬆ Upload ${k.label.toLowerCase()}<input type="file" hidden multiple accept="${k.accept}" data-lup="${tab}"></label><span class="mut g">Upload each file once, then pick it in any segment.</span></div>
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
    ? fx
        .map(
          (m) =>
            `<span class="sfxw${xon("fx:" + m.id)}" data-sel="fx:${m.id}"><button class="sfxb" data-fx="${m.id}">🔊 ${esc(bare(m.name))}</button><button class="d sfxx xs" data-fxdel="${m.id}" title="Delete this sound effect">✕</button></span>`,
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
}
