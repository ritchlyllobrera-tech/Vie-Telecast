/**
 * Loading the bundled show state, plus backup / restore.
 *
 * The original single-file build embedded the state and every upload inside the HTML
 * ("Download HTML (with all uploads)"). In this project the original media lives in
 * public/assets/media and the saved state in src/data/initialState.json, so the export
 * is now a JSON backup containing the state plus only the files uploaded in this browser.
 */
import initialState from "../data/initialState.json";
import BUNDLED from "../data/mediaManifest.json";
import { DEF, MB } from "./constants.js";
import { S, setS, fixSegs } from "./state.js";
import { flush } from "./sync.js";
import { tx } from "./media.js";
import { render } from "./render.js";

const BACKUP_FORMAT = "vienovo-telecast-backup";

const msg = (t) => {
  const e = document.getElementById("sv");
  if (e) e.textContent = t;
};

/** Adopt the bundled state if it is newer than what this browser has saved. */
export function loadInitialState() {
  if ((initialState.savedAt || 0) > (S.savedAt || 0)) {
    setS({ ...DEF, ...initialState });
    fixSegs();
    flush();
    render();
    // the header (#sv) is created by the first render, which runs on the next frame
    setTimeout(() => msg("✔ Loaded saved project"), 500);
  }
}

function b64blob(b64, type) {
  const parts = [];
  const C = 4 * 262144;
  for (let i = 0; i < b64.length; i += C) {
    const bin = atob(b64.slice(i, i + C));
    const u = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
    parts.push(u);
  }
  return new Blob(parts, { type });
}

const blobToB64 = (blob) =>
  new Promise((ok) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => ok("");
    fr.readAsDataURL(blob);
  });

export async function exportBackup() {
  flush();
  const ids = new Set(S.lib.map((m) => m.id));
  if (S.defBg) ids.add(S.defBg);
  if (S.rafMusic) ids.add(S.rafMusic);
  const files = {};
  let n = 0;
  let tot = 0;
  for (const id of ids) {
    if (BUNDLED[id]) continue; // already shipped in public/assets/media
    msg("⏳ Packing file " + ++n + "…");
    const r = await tx("readonly", (x) => x.get(id)).catch(() => null);
    if (!r || !r.blob || r.cache) continue; // cache: a copy of a server file ("Save media on this PC")
    tot += r.blob.size;
    files[id] = { type: r.blob.type || "", data: await blobToB64(r.blob) };
  }
  const blob = new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 1, state: S, files })], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vienovo-telecast-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  msg("✔ Backup downloaded (" + Object.keys(files).length + " uploaded files, " + MB(tot) + ")");
}

export async function importBackup(file) {
  msg("⏳ Reading backup…");
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (!data || data.format !== BACKUP_FORMAT || !data.state) {
    msg("⚠ That file is not a Telecast backup");
    return;
  }
  let n = 0;
  for (const [id, f] of Object.entries(data.files || {})) {
    try {
      await tx("readwrite", (x) => x.put({ id, blob: b64blob(f.data, f.type) }));
      n++;
    } catch {
      /* keep going */
    }
  }
  setS({ ...DEF, ...data.state });
  fixSegs();
  flush();
  render();
  msg("✔ Backup restored (" + n + " files)");
}
