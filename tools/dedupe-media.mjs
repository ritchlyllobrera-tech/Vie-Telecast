#!/usr/bin/env node
/**
 * Removes byte-identical duplicates from frontend/public/assets/media and rewrites
 * src/data/mediaManifest.json as { id: { url, size } }. Duplicate ids keep an entry that
 * points at the surviving file, so saved shows that reference either id still work.
 *
 * Usage: node tools/dedupe-media.mjs [frontendDir]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const frontend = path.resolve(process.argv[2] ?? "frontend");
const mediaDir = path.join(frontend, "public", "assets", "media");
const manifestPath = path.join(frontend, "src", "data", "mediaManifest.json");
const state = JSON.parse(fs.readFileSync(path.join(frontend, "src", "data", "initialState.json"), "utf8"));
const old = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const urlOf = (v) => (typeof v === "string" ? v : v.url);

const order = (state.media ?? []).map((m) => m.id); // keep the copy used earliest in the show
const rank = (id) => (order.indexOf(id) < 0 ? 1e9 : order.indexOf(id));

const hash = (file) =>
  new Promise((ok, no) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no);
  });

const groups = new Map();
for (const [id, v] of Object.entries(old)) {
  const file = path.join(mediaDir, path.basename(urlOf(v)));
  if (!fs.existsSync(file)) continue; // already an alias
  const key = await hash(file);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ id, file, url: urlOf(v), size: fs.statSync(file).size });
}

const manifest = {};
let freed = 0;
for (const items of groups.values()) {
  items.sort((a, b) => rank(a.id) - rank(b.id));
  const keep = items[0];
  for (const it of items) {
    manifest[it.id] = { url: keep.url, size: keep.size };
    if (it !== keep) {
      fs.rmSync(it.file);
      freed += it.size;
      console.log(`  removed duplicate ${path.basename(it.file)} -> ${path.basename(keep.file)}`);
    }
  }
}
// aliases that already pointed elsewhere
for (const [id, v] of Object.entries(old)) if (!manifest[id]) manifest[id] = typeof v === "string" ? { url: v, size: 0 } : v;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Freed ${(freed / 1048576).toFixed(1)} MB; manifest has ${Object.keys(manifest).length} ids`);
