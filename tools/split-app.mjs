#!/usr/bin/env node
/**
 * Splits the extracted single-file app (extracted/app.js + extracted/style.pretty.css)
 * into ES modules under frontend/src/telecast/. Run after tools/extract-index.mjs.
 *
 * Line numbers below refer to the original <script> block (line 1 = "<script>"),
 * each range is checked against an expected prefix so a changed source fails loudly.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("frontend/src/telecast");
const src = fs.readFileSync("extracted/app.js", "utf8").replace(/\r\n/g, "\n").split("\n");
const L = (n) => src[n - 2]; // original line n -> array index
if (L(2) !== '"use strict";') throw new Error("unexpected app.js layout");

/* ---------- exact patches (each must match exactly once) ---------- */
const patch = (n, from, to) => {
  const s = L(n);
  const i = s.indexOf(from);
  if (i < 0 || s.indexOf(from, i + 1) >= 0) throw new Error(`patch on line ${n} did not match exactly once: ${from}`);
  src[n - 2] = s.slice(0, i) + to + s.slice(i + from.length);
};
// state is reassigned from other modules -> go through setS()
patch(22, "else if(d.S&&LIVE){S=d.S;render()}", "else if(d.S&&LIVE){setS(d.S);render()}");
patch(23, "S=JSON.parse(e.newValue);render()", "setS(JSON.parse(e.newValue));render()");
patch(34, 'if(d.t==="state"&&d.S){S=d.S;', 'if(d.t==="state"&&d.S){setS(d.S);');
// pop-out: navigate the window to "#live" instead of document.write()-ing a copy of the page
patch(27, "w.document.open();w.document.write(SRC);w.document.close();w.focus()", 'w.location.href=location.href.split("#")[0]+"#live";w.focus()');
// media: fall back to the extracted files in public/assets/media
patch(32, "if(!u&&LIVE&&window.opener)", "if(!u&&BUNDLED[id])u=BUNDLED[id];if(!u&&LIVE&&window.opener)");
// single-file "Download HTML" no longer applies -> JSON backup + restore
patch(148, '<button id="dlh" title="Saves your settings, pictures, music and videos inside the HTML file">💾 Download HTML (with all uploads)</button>',
  '<button id="dlh" title="Saves your settings plus any pictures, music or videos uploaded in this browser">💾 Download backup</button><label class="b" title="Restore a backup file">📂 Restore backup<input type="file" hidden accept=".json,application/json" id="rbk"></label>');
patch(157, 'B("#dlh",exportHTML);', 'B("#dlh",exportBackup);$(r,"#rbk").onchange=e=>{const f=e.target.files[0];e.target.value="";if(f)importBackup(f)};');

/* ---------- module layout ---------- */
const R = (a, b = a) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const MODULES = {
  "constants.js": {
    doc: "Static configuration: asset URLs, default rundown, scene names, palette and tiny helpers.",
    lines: [...R(5, 12), 37, 48, 58, 81, 138],
    exports: ["LOGO", "BG0", "RAFM", "K", "$", "esc", "SEGS", "SCENES", "AUTO", "DEF", "MB", "fm", "fmt", "WP", "norm"],
  },
  "state.js": {
    doc: "The single show state object `S` (persisted to localStorage) and helpers that normalise it.",
    lines: [13, 14, 130, 139],
    tail: "export function setS(v){S=v}",
    exports: ["S", "setS", "fixSegs", "dedupe"],
  },
  "sync.js": {
    doc: "Saving + syncing state between the control room and the live screen (BroadcastChannel, postMessage, pop-out window).",
    lines: [...R(15, 24), 26, 27, ...R(33, 36), 94, 95, 131, 132],
    exports: ["LIVE", "ch", "master", "sendPop", "flush", "quiet", "save", "popOut", "done", "handleEnded", "doAct", "act"],
  },
  "media.js": {
    doc: "Media store: IndexedDB for uploads, with the extracted files in public/assets/media as fallback.",
    head: 'import BUNDLED from "../data/mediaManifest.json";',
    lines: [...R(28, 32), ...R(38, 46)],
    exports: ["idb", "tx", "urls", "pend", "url", "load", "upMsg", "upload"],
  },
  "playback.js": {
    doc: "Audio/video playback commands and keeping the control-room monitor in step with the live screen.",
    lines: [47, ...R(49, 56), ...R(96, 100), 121, 122, 123],
    exports: ["followPop", "doCmd", "vidPlaying", "startRaf", "rafOn"],
  },
  "stage/stage.js": {
    doc: "The 16:9 broadcast stage (used by both the monitor and the live screen): background, snow, panels, ticker, awards.",
    lines: [57, 59, 60, ...R(61, 80), ...R(101, 119)],
    exports: ["FE", "buildStage", "tick", "updateStage"],
  },
  "stage/wheel.js": {
    doc: "Grand-raffle spin wheel, winner reveal card and confetti.",
    lines: R(82, 93),
    exports: ["drawWheel", "reveal", "confetti"],
  },
  "actions.js": {
    doc: "Show actions: go to a segment, send a playback command, spin the raffle.",
    lines: [120, ...R(133, 137), 140],
    exports: ["setSeg", "cmd", "spin"],
  },
  "control/control.js": {
    doc: "Control-room page: header, cards, bindings and per-render refresh.",
    head: 'import { exportBackup, importBackup } from "../persistence.js";',
    lines: [25, 124, ...R(125, 129), 141, ...R(146, 167), ...R(188, 197)],
    exports: ["setTx", "updNext", "dupTab", "buildControl", "renderControl"],
  },
  "control/rundown.js": { doc: "Rundown list (card 1).", lines: [168, 169], exports: ["renderRundown"] },
  "control/editor.js": { doc: "Segment editor with media uploads (card 2).", lines: R(170, 187), exports: ["renderEditor"] },
  "render.js": {
    doc: "Render loop, 1-second scheduler (auto-pilot) and the start-of-show cue dialog.",
    lines: [...R(142, 145), ...R(198, 202), ...R(218, 220)],
    exports: ["raf", "render", "doRender", "showCue", "cueDone"],
  },
};
// handwritten modules that other modules may import from
const EXTERNAL = { "persistence.js": ["exportBackup", "importBackup", "loadInitialState"] };
// names that only occur as local variables/parameters in these modules (verified with oxlint no-unused-vars)
const SHADOWED = { "stage/wheel.js": ["ch"], "stage/stage.js": ["K", "ch"], "control/control.js": ["pend"] };
const DROPPED =new Set([1, 2, 3, 4, ...R(203, 217), ...R(221, 225)]); // wrapper, embedded-file loader, export/import, boot
const PREFIX = { 5: "const LOGO=", 13: "let S;", 15: "const LIVE=", 28: "/* media store", 38: "function upMsg", 47: "let lastPos", 57: "/* stage", 82: "function drawWheel", 96: "async function doCmd", 101: "function updateStage", 120: "/* actions", 133: "function setSeg", 142: "let lm=true", 146: "/* control UI", 168: "function renderRundown", 170: "function renderEditor", 188: "function renderControl", 198: "function raf", 218: "function showCue" };

/* ---------- sanity: every line assigned exactly once ---------- */
const owner = {};
for (const [file, m] of Object.entries(MODULES)) for (const n of m.lines) {
  if (owner[n]) throw new Error(`line ${n} in both ${owner[n]} and ${file}`);
  owner[n] = file;
}
for (let n = 1; n <= src.length + 1; n++) if (!owner[n] && !DROPPED.has(n) && (L(n) ?? "").trim()) throw new Error(`line ${n} unassigned: ${L(n).slice(0, 60)}`);
for (const [n, p] of Object.entries(PREFIX)) if (!L(+n).startsWith(p)) throw new Error(`line ${n} expected to start with ${p}`);

/* ---------- build modules ---------- */
const all = { ...Object.fromEntries(Object.entries(MODULES).map(([f, m]) => [f, m.exports])), ...EXTERNAL };
// identifier, but not a property access (a.name) - spread (...name) still counts
const idRe = (name) => new RegExp(`(?<![\\w$])(?<![^.]\\.)${name.replace(/\$/g, "\\$")}(?![\\w$])`);
// blank out string literals / template text / comments so identifier matching only sees code
function codeOnly(s) {
  let out = "", i = 0;
  const stack = []; // template-literal nesting: brace depth at each `${`
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; out += " "; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1; out += '""'; i = j + 1; continue; }
    if (c === "`" || (c === "}" && stack.length && stack[stack.length - 1] === depth)) {
      if (c === "}") stack.pop();
      let j = i + 1;
      while (j < s.length && s[j] !== "`" && !(s[j] === "$" && s[j + 1] === "{")) j += s[j] === "\\" ? 2 : 1;
      out += " ";
      if (s[j] === "$") { stack.push(depth); i = j + 2; } else i = j + 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    out += c; i++;
  }
  return out;
}
const rel = (from, to) => { let r = path.posix.relative(path.posix.dirname(from), to); return r.startsWith(".") ? r : "./" + r; };

for (const [file, m] of Object.entries(MODULES)) {
  let body = m.lines.map(L).join("\n");
  if (m.tail) body += "\n" + m.tail;
  const imports = [];
  const usedNames = new Set();
  const code = codeOnly(body);
  for (const [other, names] of Object.entries(all)) {
    if (other === file) continue;
    const used = names.filter((n) => idRe(n).test(code) && !(SHADOWED[file] || []).includes(n));
    if (file === "control/control.js" && other === "persistence.js") continue; // in m.head
    if (used.length) { imports.push(`import { ${used.join(", ")} } from "${rel(file, other)}";`); used.forEach((u) => usedNames.add(u)); }
  }
  if ([...body.matchAll(/(?<![\w$.])S\s*=(?!=)/g)].length && file !== "state.js") throw new Error(`${file} still assigns S`);
  for (const n of usedNames) { // imported bindings must not be reassigned
    const re = new RegExp(`(?<![\\w$.]|const |let |var )${n.replace(/\$/g, "\\$")}\\s*(=(?![=>])|\\+\\+|--)`);
    if (re.test(code)) console.warn(`  ! ${file}: possible reassignment of imported "${n}" - check manually`);
  }
  const exportsLine = `export { ${m.exports.filter((e) => !(m.tail || "").includes(`export const ${e}`) && !(m.tail || "").includes(`export function ${e}`)).join(", ")} };`;
  const text = [`/** ${m.doc} */`, ...(m.head ? [m.head] : []), ...imports, "", body, "", exportsLine, ""].join("\n");
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), text);
  console.log(`  ${file.padEnd(22)} ${String(m.lines.length).padStart(3)} source lines, imports from ${imports.length} modules`);
}

/* ---------- CSS: same cascade order, split by concern ---------- */
const css = fs.readFileSync("extracted/style.pretty.css", "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
const C = (a, b) => css.slice(a - 1, b).join("\n");
if (!css[934].startsWith("#cue") || !css[1173].startsWith("#dup") || !css[316].startsWith(".stage {") || !css[1093].startsWith(".ice {")) throw new Error("unexpected CSS layout");
const STY = path.join(OUT, "styles");
fs.mkdirSync(STY, { recursive: true });
fs.writeFileSync(path.join(STY, "base.css"), "/* Theme tokens (light/dark), reset and shared keyframes. */\n" + C(1, 120) + "\n");
fs.writeFileSync(path.join(STY, "control.css"), "/* Control room: header, cards, buttons, inputs, rundown, thumbnails, dialogs. */\n" + C(121, 316) + "\n" + C(935, 959) + "\n" + C(1174, 1183) + "\n");
fs.writeFileSync(path.join(STY, "stage.css"), "/* Broadcast stage: layout, panels, ticker, counters, wheel, winner/award cards.\n   Later rules intentionally override earlier ones - keep the order. */\n" + C(317, 934) + "\n" + C(960, 1093) + "\n");
fs.writeFileSync(path.join(STY, "ice.css"), "/* Frosted \"ice\" card treatment and final stage overrides (must load last). */\n" + C(1094, 1173) + "\n" + C(1184, 1336) + "\n");
console.log("  styles/ base.css control.css stage.css ice.css");
