#!/usr/bin/env node
/**
 * Streaming extractor for the single-file "Vienovo Telecast Control" export.
 *
 * The export is ~1.9 GB because every uploaded song, video and picture is embedded as
 * base64 inside <script type="application/x-vtc" class="vtc-m" data-id=".." data-type="..">
 * blocks. This script never loads the file into memory: it streams it in 16 MB chunks,
 * decodes each media block straight to disk, and keeps only the (small) HTML/CSS/JS text.
 *
 * Usage:  node tools/extract-index.mjs [input.html] [frontendDir]
 * Output:
 *   <frontend>/public/assets/media/<id>.<ext>   embedded uploads (songs, videos, pictures)
 *   <frontend>/public/assets/<name>.<ext>       large inline data: URIs (logo, default bg, raffle music)
 *   <frontend>/src/data/mediaManifest.json      media id -> public URL
 *   <frontend>/src/data/initialState.json       the saved show state (rundown, raffle pool, ...)
 *   extracted/                                  raw parts + structure-report.json for reference
 */
import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] ?? "index.html.html");
const frontend = path.resolve(process.argv[3] ?? "frontend");
const rawDir = path.resolve("extracted");
const mediaDir = path.join(frontend, "public", "assets", "media");
const assetDir = path.join(frontend, "public", "assets");
const dataDir = path.join(frontend, "src", "data");
for (const d of [rawDir, mediaDir, dataDir]) fs.mkdirSync(d, { recursive: true });

const EXT = {
  "video/mp4": "mp4", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/svg+xml": "svg",
};
const ext = (type) => EXT[type] ?? "bin";

const OPEN = Buffer.from('<script type="application/x-vtc"');
const CLOSE = Buffer.from("</script>");
const OPEN_TAG_RE = /^<script type="application\/x-vtc" class="vtc-m" data-id="([A-Za-z0-9_-]+)" data-type="([\w/+.-]*)">$/;

const total = fs.statSync(input).size;
const fd = fs.openSync(input, "r");
const CHUNK = 16 * 1024 * 1024;
const readBuf = Buffer.alloc(CHUNK);

const textParts = []; // everything that is not a media block
const media = [];     // { id, type, file, offset, base64Bytes, bytes }
let state = "text";
let carry = Buffer.alloc(0);
let cur = null;       // current media block being written
let b64carry = "";
let pos = 0;          // file offset of carry[0]
let lastPct = -1;

function writeB64(str, final) {
  const clean = b64carry + str.replace(/[^A-Za-z0-9+/=]/g, "");
  const usable = final ? clean.length : clean.length - (clean.length % 4);
  if (usable > 0) {
    const bin = Buffer.from(clean.slice(0, usable), "base64");
    fs.writeSync(cur.fd, bin);
    cur.bytes += bin.length;
  }
  cur.base64Bytes += str.length;
  b64carry = clean.slice(usable);
}

for (;;) {
  const n = fs.readSync(fd, readBuf, 0, CHUNK, null);
  const eof = n === 0;
  let data = eof ? carry : Buffer.concat([carry, readBuf.subarray(0, n)]);
  let base = pos;

  for (;;) {
    if (state === "text") {
      const i = data.indexOf(OPEN);
      if (i < 0) {
        const keep = eof ? 0 : Math.min(data.length, OPEN.length - 1);
        textParts.push(data.subarray(0, data.length - keep));
        base += data.length - keep;
        data = data.subarray(data.length - keep);
        break;
      }
      const gt = data.indexOf(0x3e, i); // '>'
      if (gt < 0 && !eof) { textParts.push(data.subarray(0, i)); base += i; data = data.subarray(i); break; }
      const tag = data.subarray(i, gt + 1).toString("latin1");
      const m = OPEN_TAG_RE.exec(tag);
      if (!m) { // e.g. the template string inside the app's own export code - keep as text
        textParts.push(data.subarray(0, i + OPEN.length));
        base += i + OPEN.length;
        data = data.subarray(i + OPEN.length);
        continue;
      }
      textParts.push(data.subarray(0, i));
      const [, id, type] = m;
      const file = `${id}.${ext(type)}`;
      cur = { id, type, file, offset: base + i, base64Bytes: 0, bytes: 0, fd: fs.openSync(path.join(mediaDir, file), "w") };
      b64carry = "";
      state = "media";
      base += gt + 1;
      data = data.subarray(gt + 1);
    } else {
      const i = data.indexOf(CLOSE);
      if (i < 0) {
        const keep = eof ? 0 : Math.min(data.length, CLOSE.length - 1);
        writeB64(data.subarray(0, data.length - keep).toString("latin1"), false);
        base += data.length - keep;
        data = data.subarray(data.length - keep);
        if (eof) throw new Error(`Unterminated media block ${cur.id}`);
        break;
      }
      writeB64(data.subarray(0, i).toString("latin1"), true);
      fs.closeSync(cur.fd);
      delete cur.fd;
      media.push(cur);
      cur = null;
      state = "text";
      base += i + CLOSE.length;
      data = data.subarray(i + CLOSE.length);
    }
  }
  carry = Buffer.from(data);
  pos = base;
  const pct = Math.floor(((pos + carry.length) / total) * 100);
  if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; process.stdout.write(`\r  streaming... ${pct}%`); }
  if (eof) break;
}
fs.closeSync(fd);
process.stdout.write("\n");

/* ---------- split the remaining (small) HTML ---------- */
let html = Buffer.concat(textParts).toString("utf8");
const report = { input, inputBytes: total, remainingTextBytes: Buffer.byteLength(html), sections: [], media: [], inlineDataUris: [] };
const section = (name, str, note) => report.sections.push({ name, bytes: Buffer.byteLength(str), note });

const pick = (re, label) => {
  const m = re.exec(html);
  if (!m) throw new Error(`Could not find ${label}`);
  return m;
};

const runtime = pick(/<!-- frame-runtime -->([\s\S]*?)<!-- \/frame-runtime -->/, "frame runtime");
section("frame-runtime (claude.ai artifact host scripts)", runtime[1], "dropped - only needed inside claude.ai");
const title = pick(/<title>([\s\S]*?)<\/title>/, "title")[1];
const icon = pick(/<link rel="icon" href="([^"]*)"/, "favicon")[1];
const style = pick(/<style>([\s\S]*?)<\/style>/, "style");
const stateJson = pick(/<script type="application\/json" id="vtc-data">([\s\S]*?)<\/script>/, "saved state");
// the app script is the last plain <script> in the document
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const app = scripts[scripts.length - 1];
section("<title>", title);
section("<link rel=icon> (inline SVG)", icon);
section("<style>", style[1]);
section("vtc-data JSON (saved show state)", stateJson[1]);
section("app <script>", app[1]);

/* ---------- pull large inline data: URIs out of CSS + JS ---------- */
let inlineN = 0;
function extractDataUris(src, where) {
  // matches  NAME="data:..;base64,.."  or a bare  data:..;base64,..  (e.g. inside CSS url())
  return src.replace(/(?:\b(\w+)=")?data:([\w/+.-]+);base64,([A-Za-z0-9+/=]{1024,})/g, (all, name, type, b64) => {
    const base = name ? name.toLowerCase() : `${where}-${++inlineN}`;
    const nice = { logo: "logo", bg0: "background-default", rafm: "raffle-default" }[base] ?? base;
    const file = `${nice}.${ext(type)}`;
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(assetDir, file), buf);
    report.inlineDataUris.push({ name: name ?? null, where, type, file: `/assets/${file}`, bytes: buf.length });
    return name ? `${name}="/assets/${file}` : `/assets/${file}`;
  });
}
const css = extractDataUris(style[1], "css");
const js = extractDataUris(app[1], "js");

/* ---------- write outputs ---------- */
fs.writeFileSync(path.join(rawDir, "style.css"), css.trim() + "\n");
fs.writeFileSync(path.join(rawDir, "app.js"), js.trim() + "\n");
fs.writeFileSync(path.join(rawDir, "frame-runtime.html"), runtime[1]);
fs.writeFileSync(path.join(rawDir, "head.json"), JSON.stringify({ title, icon }, null, 2));
const stateObj = JSON.parse(stateJson[1]);
fs.writeFileSync(path.join(dataDir, "initialState.json"), JSON.stringify(stateObj, null, 2) + "\n");

const names = Object.fromEntries((stateObj.media ?? []).map((m) => [m.id, m]));
const manifest = {};
for (const m of media) {
  manifest[m.id] = { url: `/assets/media/${m.file}`, size: m.bytes };
  report.media.push({ id: m.id, type: m.type, file: `/assets/media/${m.file}`, bytes: m.bytes, base64Bytes: m.base64Bytes, offset: m.offset, name: names[m.id]?.name ?? null, segment: names[m.id]?.seg ?? null, kind: names[m.id]?.kind ?? null });
}
fs.writeFileSync(path.join(dataDir, "mediaManifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const orphans = (stateObj.media ?? []).filter((m) => !manifest[m.id]).map((m) => m.id);
report.mediaReferencedButMissing = orphans;
report.totals = { mediaFiles: media.length, mediaBytes: media.reduce((a, m) => a + m.bytes, 0), mediaBase64Bytes: media.reduce((a, m) => a + m.base64Bytes, 0) };
fs.writeFileSync(path.join(rawDir, "structure-report.json"), JSON.stringify(report, null, 2) + "\n");

const MB = (b) => (b / 1048576).toFixed(1).padStart(8) + " MB";
console.log(`\nInput: ${MB(total)}`);
console.log("Sections (after media removed):");
for (const s of report.sections) console.log(`  ${MB(s.bytes)}  ${s.name}${s.note ? "  (" + s.note + ")" : ""}`);
console.log(`Inline data URIs extracted: ${report.inlineDataUris.length}`);
for (const d of report.inlineDataUris) console.log(`  ${MB(d.bytes)}  ${d.file}  (${d.where} ${d.name ?? ""})`);
console.log(`Media blocks extracted: ${media.length}, ${MB(report.totals.mediaBytes)} decoded (${MB(report.totals.mediaBase64Bytes)} as base64)`);
if (orphans.length) console.log(`  ! referenced in state but not embedded: ${orphans.join(", ")}`);
