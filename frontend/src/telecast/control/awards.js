/** Employee awards list (card 6): awardees in one folder per award; click an awardee to put them on the Live Screen. */
import { $, esc, MEDAL, PER, LOCS } from "../constants.js";
import { S, awTitle } from "../state.js";
import { canControl, myLoc } from "../net.js";
import { save } from "../sync.js";
import { now } from "../clock.js";

/** folders closed on this computer (by award name) */
const shut = new Set();

/* ---------- folder location ----------
 * A folder can belong to one location (S.awLoc[name] = "cebu" | "ncr" | "cdo"; none = all locations).
 * An Editor only sees the folders of their own location (and those for all locations);
 * the Director, and anyone working alone, sees every folder. */
const SHORT = { cebu: "Cebu", ncr: "NCR", cdo: "CDO" };
const locOf = (name) => (S.awLoc && LOCS[S.awLoc[name]] ? S.awLoc[name] : "");
const seesAll = () => canControl() || !myLoc();
/* The Director can narrow their own list to one location (kept on this computer only):
 * "" = every folder; "cebu" etc. = that location's folders plus the ones for all locations. */
const VKEY = "vienovo-aw-view";
let view = "";
try {
  view = localStorage.getItem(VKEY) || "";
} catch {}
const viewLoc = () => (seesAll() && LOCS[view] ? view : "");
const visible = (name) =>
  seesAll() ? !viewLoc() || !locOf(name) || locOf(name) === viewLoc() : !locOf(name) || locOf(name) === myLoc();
function setLoc(name, loc) {
  const o = { ...(S.awLoc || {}) };
  if (LOCS[loc]) o[name] = loc;
  else delete o[name];
  S.awLoc = o;
}
/** <option>s for a location picker */
const locOpts = (v) =>
  `<option value="" ${v ? "" : "selected"}>🌐 All locations</option>` +
  Object.entries(LOCS)
    .map(([k, nm]) => `<option value="${k}" ${v === k ? "selected" : ""}>📍 ${esc(nm)}</option>`)
    .join("");
const locChip = (name) => {
  const l = locOf(name);
  return l
    ? `<span class="locc l-${l}${l === myLoc() ? " me" : ""}" title="Shown at ${esc(LOCS[l])} only">📍 ${esc(SHORT[l] || LOCS[l])}</span>`
    : `<span class="locc all" title="Shown at every location">🌐 All</span>`;
};

/* ---------- drag a folder to change the order ---------- */
let dragName = "";
/** move folder `name` before folder `before` ("" = to the end); the order is kept in S.awFolders */
function moveFolder(name, before) {
  const all = allFolders().map((f) => f.name).filter((x) => x !== name),
    at = before ? all.indexOf(before) : -1;
  all.splice(at < 0 ? all.length : at, 0, name);
  S.awFolders = all;
  save();
}
/** the folder being renamed on this computer: { name, text } (text = what is typed so far) */
let ren = null;
/** the folder new awardees go into (the form's Folder picker), on this computer */
let cur = "";

const clean = (t) => String(t || "").trim().replace(/\s+/g, " ").slice(0, 120);
/** set the award shown on the Live Screen for folder `name` ("" = use the folder name) */
function setTitle(name, title) {
  const t = clean(title),
    o = { ...(S.awTitle || {}) };
  if (t && t !== name) o[name] = t;
  else delete o[name];
  S.awTitle = o;
}
/** create an (empty) award folder with the award shown on screen; returns false when the name is empty */
export function createFolder(name, title, loc) {
  name = clean(name);
  if (!name) return false;
  if (!allFolders().some((f) => f.name === name)) S.awFolders = [...(S.awFolders || []), name];
  setLoc(name, seesAll() ? loc : myLoc()); // an Editor's folders belong to their location
  if (clean(title)) setTitle(name, title);
  cur = name;
  shut.delete(name);
  save();
  return true;
}
/** the folder picked in the form for new awardees ("" = no folder yet) */
export const curFolder = () => (folders().some((f) => f.name === cur) ? cur : (folders().at(-1) || {}).name || "");
export const setCurFolder = (v) => (cur = v);

/** delete folder `name` and every awardee in it */
function deleteFolder(name) {
  const n = S.awards.filter((a) => (a.award || "Award") === name).length;
  if (!confirm(n ? `Delete the folder "${name}" and its ${n} awardee${n > 1 ? "s" : ""}?` : `Delete the empty folder "${name}"?`)) return;
  const onScreen = S.awards[S.spot];
  S.awards = S.awards.filter((a) => (a.award || "Award") !== name);
  S.spot = onScreen ? S.awards.indexOf(onScreen) : -1;
  S.awFolders = (S.awFolders || []).filter((x) => x !== name);
  setTitle(name, "");
  setLoc(name, "");
  if (S.spotList && S.spotList.award === name) S.spotList = null;
  for (const g of S.segs) {
    const m = awfMap(g);
    for (const k in m) m[k] = m[k].filter((x) => x !== name);
    if (g.awf) g.awf = m;
  }
  save();
}

/** edit folder `from`: new folder name `to` and the award shown on screen `title` */
function renameFolder(from, to, title) {
  to = clean(to);
  if (!to) return false;
  if (to === from) {
    setTitle(from, title);
    save();
    return true;
  }
  const into = allFolders().some((f) => f.name === to);
  if (into && !confirm(`There is already a folder "${to}". Move the awardees of "${from}" into it?`)) return false;
  if (!into) setTitle(to, title);
  setTitle(from, "");
  if (!into) setLoc(to, locOf(from));
  setLoc(from, "");
  for (const a of S.awards) if ((a.award || "Award") === from) a.award = to;
  S.awFolders = (S.awFolders || []).map((x) => (x === from ? to : x)).filter((x, i, a) => a.indexOf(x) === i);
  if (cur === from) cur = to;
  for (const g of S.segs) {
    const m = awfMap(g);
    for (const k in m) m[k] = m[k].map((x) => (x === from ? to : x)).filter((x, i, a) => a.indexOf(x) === i);
    if (g.awf) g.awf = m;
  }
  if (S.spotList && S.spotList.award === from) S.spotList = { ...S.spotList, award: to, page: into ? 0 : S.spotList.page };
  if (shut.delete(from)) shut.add(to);
  save();
  return true;
}

/** <option>s for the medal picker */
export const medalOpts = (v) =>
  `<option value="" ${v ? "" : "selected"}>No medal</option>` +
  Object.entries(MEDAL)
    .map(([k, [ic, nm]]) => `<option value="${k}" ${v === k ? "selected" : ""}>${ic} ${nm}</option>`)
    .join("");

/** the folders this computer shows (an Editor: their location's and all-location folders) */
const folders = () => allFolders().filter((f) => visible(f.name));
/** awards grouped by award name: created folders first (empty ones too), then any other award names: [{ name, idx: [award indexes] }] */
function allFolders() {
  const m = new Map();
  for (const k of S.awFolders || []) m.set(k, []);
  S.awards.forEach((a, i) => {
    const k = a.award || "Award";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return [...m].map(([name, idx]) => ({ name, idx }));
}

/** put award `i` on the Live Screen (-1 = hide) */
function show(i) {
  S.spot = i;
  S.spotList = null;
  if (i >= 0) S.spotTs = now();
  save();
}

/** the awardee after the one on screen, in the order of the list (folder by folder) */
export function nextAward() {
  const order = folders().flatMap((f) => f.idx);
  if (!order.length) return;
  const at = order.indexOf(S.spot);
  show(order[Math.min(order.length - 1, at + 1)]);
}

/** list the awardees of award `name` on the Live Screen, page `page` (PER names each) */
function showList(name, page) {
  S.spot = -1;
  S.spotList = { award: name, page, ts: now() };
  save();
}

/** buttons for showing all of a folder's names, PER at a time (Next only while names are left) */
function listBtns(f, fi) {
  if (f.idx.length < 2) return "";
  const pages = Math.ceil(f.idx.length / PER),
    L = S.spotList && S.spotList.award === f.name ? S.spotList : null;
  if (!L) return `<button data-lst="${fi}" title="Show all of this award's awardees on the Live Screen (up to ${PER} at a time; Next shows the rest)">📋 Show all names</button>`;
  const pg = Math.min(L.page, pages - 1),
    from = pg * PER + 1,
    to = Math.min(f.idx.length, from + PER - 1);
  return (
    `<span class="onair" title="Names ${from} to ${to} of ${f.idx.length} are on the Live Screen">● ${from}–${to} of ${f.idx.length}</span>` +
    (pages > 1 ? `<button data-lprev="${fi}" ${pg ? "" : "disabled"} title="Show the previous ${PER} names">◀ Back</button>` : "") +
    (pg < pages - 1
      ? `<button class="p" data-lnext="${fi}" title="Show the next ${PER} names">Next ${PER} ▶</button>`
      : `<button class="p" data-ldone="${fi}" title="${pages > 1 ? "That was the last page: hide the list" : "Hide the list"}">✔ Done</button>`)
  );
}

/* ---------- the awards folders locked to a segment ----------
 * A segment can have folders per location (g.awf). While that segment is on, their controls show under the monitor,
 * so the Director or an Editor can put the awardees on screen without opening the Employee awards panel. */
/** a segment's locked folders per location: { cebu: ["folder", …], ncr: […], cdo: […] }
 * (older saves: one name for every location, or one name per location) */
export function awfMap(g) {
  const v = g && g.awf,
    list = (x) => (Array.isArray(x) ? x.filter((n) => typeof n === "string" && n) : typeof x === "string" && x ? [x] : []);
  if (typeof v === "string") return v ? Object.fromEntries(Object.keys(LOCS).map((k) => [k, [v]])) : {};
  const o = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (list(x).length) o[k] = list(x);
  return o;
}
/** folders that can be locked for location `loc`: that location's folders and the ones for all locations */
export const foldersFor = (loc) => allFolders().filter((f) => !locOf(f.name) || locOf(f.name) === loc);
/** which location's folder the panel under the monitor shows: an Editor = their own; the Director picks (default: their own) */
let pLoc = "";
const panelLoc = (m) => {
  if (!seesAll()) return myLoc();
  if (m[pLoc]) return pLoc;
  const own = LOCS[myLoc()] ? myLoc() : "cebu";
  return m[own] ? own : Object.keys(LOCS).find((k) => m[k]) || own;
};
/** the folder picked in the panel on this computer (by name) */
let pFold = "";
/** the locked folders of the segment that is on, for the panel's location: [{ name, idx }] */
function segFolders() {
  const g = S.started ? S.segs[S.seg] : null;
  if (!g) return [];
  const m = awfMap(g),
    loc = panelLoc(m),
    F = foldersFor(loc);
  return (m[loc] || []).map((n) => F.find((f) => f.name === n)).filter(Boolean);
}
/** the folder the panel shows (null = the segment has none here): the picked one, else the one on screen, else the first */
export function segFolder() {
  const L = segFolders();
  return (
    L.find((f) => f.name === pFold) ||
    L.find((f) => f.idx.includes(S.spot) || (S.spotList && S.spotList.award === f.name)) ||
    L[0] ||
    null
  );
}
export function renderSegFolder(r) {
  const box = $(r, "#qfold");
  if (!box) return;
  const f = segFolder();
  box.hidden = !f;
  if (!f) return (box._h = "");
  const m = awfMap(S.segs[S.seg]),
    locs = seesAll() ? Object.keys(LOCS).filter((k) => m[k]) : [],
    cl = panelLoc(m),
    SF = segFolders();
  const L = S.spotList && S.spotList.award === f.name ? S.spotList : null,
    pages = Math.max(1, Math.ceil(f.idx.length / PER)),
    pg = L ? Math.min(L.page, pages - 1) : -1,
    on = f.idx.includes(S.spot) || !!L,
    H =
      (locs.length > 1
        ? `<div class="row qflocs">${locs.map((k) => `<button data-ql="${k}" class="${k === cl ? "p" : ""}" aria-pressed="${k === cl}" title="Show the folder locked for ${esc(LOCS[k])}">📍 ${esc(SHORT[k] || LOCS[k])}</button>`).join("")}</div>`
        : "") +
      (SF.length > 1
        ? `<div class="row qfolds">${SF.map((x) => {
            const live = x.idx.includes(S.spot) || !!(S.spotList && S.spotList.award === x.name);
            return `<button data-qfo="${esc(x.name)}" class="${x === f ? "p" : ""}" aria-pressed="${x === f}" title="Control this folder">📁 ${esc(x.name)} <span class="mut">${x.idx.length}</span>${live ? " ●" : ""}</button>`;
          }).join("")}</div>`
        : "") +
      `<div class="qfh"><b>🏆 ${esc(awTitle(f.name))}</b>${LOCS[cl] ? ` <span class="locc l-${cl}">📍 ${esc(SHORT[cl] || LOCS[cl])}</span>` : ""} <span class="mut">📁 ${esc(f.name)} · ${f.idx.length} awardee${f.idx.length === 1 ? "" : "s"}</span>${on ? ' <span class="onair">● ON SCREEN</span>' : ""}</div>` +
      `<div class="row"><button class="p" data-qf="next" ${f.idx.length ? "" : "disabled"} title="Show the next awardee of this folder">▶ Next awardee</button>` +
      (f.idx.length > 1
        ? L
          ? (pages > 1 ? `<button data-qf="prev" ${pg ? "" : "disabled"}>◀ Back</button>` : "") +
            (pg < pages - 1 ? `<button class="p" data-qf="more">Next ${PER} ▶</button>` : `<button data-qf="done">✔ Done</button>`) +
            `<span class="mut">names ${pg * PER + 1}–${Math.min(f.idx.length, (pg + 1) * PER)} of ${f.idx.length}</span>`
          : `<button data-qf="list" title="Show all of this folder's names on the Live Screen (${PER} at a time)">📋 Show all names</button>`
        : "") +
      `<button data-qf="hide" ${on ? "" : "disabled"} title="Take this folder off the Live Screen">🙈 Hide</button></div>` +
      (f.idx.length
        ? `<div class="qfl">${f.idx
            .map((i, n) => {
              const a = S.awards[i];
              return `<button class="${i === S.spot ? "act" : ""}" data-qs="${i}" aria-pressed="${i === S.spot}" title="${i === S.spot ? "On screen: click to hide" : "Show on the Live Screen"}">${n + 1}. ${MEDAL[a.medal] ? MEDAL[a.medal][0] + " " : ""}${esc(a.name)}</button>`;
            })
            .join("")}</div>`
        : '<div class="mut">This folder is empty: add employees in 🏆 Employee awards.</div>');
  if (box._h !== H) {
    box._h = H;
    box.innerHTML = H;
  }
  box.querySelectorAll("[data-ql]").forEach(
    (b) =>
      (b.onclick = () => {
        pLoc = b.dataset.ql;
        pFold = "";
        renderSegFolder(r);
      }),
  );
  box.querySelectorAll("[data-qfo]").forEach(
    (b) =>
      (b.onclick = () => {
        pFold = b.dataset.qfo;
        renderSegFolder(r);
      }),
  );
  box.querySelectorAll("[data-qs]").forEach((b) => (b.onclick = () => show(+b.dataset.qs === S.spot ? -1 : +b.dataset.qs)));
  box.querySelectorAll("[data-qf]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.qf;
      if (k === "next") show(f.idx[Math.min(f.idx.length - 1, f.idx.indexOf(S.spot) + 1)]);
      else if (k === "list") showList(f.name, 0);
      else if (k === "more") showList(f.name, Math.min(pages - 1, pg + 1));
      else if (k === "prev") showList(f.name, Math.max(0, pg - 1));
      else if (k === "done") {
        S.spotList = null;
        save();
      } else if (k === "hide") {
        if (f.idx.includes(S.spot)) S.spot = -1;
        if (L) S.spotList = null;
        save();
      }
    };
  });
}

export function renderAwards(r) {
  const al = $(r, "#al"),
    F = folders(),
    H =
      F.map((f, fi) => {
        const open = !shut.has(f.name),
          on = f.idx.includes(S.spot) || !!(S.spotList && S.spotList.award === f.name);
        return (
          `<div class="awf${on ? " on" : ""}" data-fi="${fi}"><div class="awh">${
            ren && ren.name === f.name
              ? `<span class="awt awren"><label class="mut">📁 Folder name<input class="g" data-rnin="${fi}" value="${esc(ren.text)}" maxlength="120"></label><label class="mut">🏆 Award shown on screen<input class="g" data-rtin="${fi}" value="${esc(ren.title)}" placeholder="Same as the folder name" maxlength="120"></label><label class="mut">📍 Location<select data-rlin="${fi}" ${seesAll() ? "" : "disabled"}>${locOpts(ren.loc)}</select></label><span class="row"><button class="p" data-rnok="${fi}" title="Save (Enter)">✔ Save</button><button data-rnno="1" title="Keep the old names (Esc)">Cancel</button></span></span>`
              : `<button class="dh" data-fdrag="${fi}" draggable="true" title="Drag to change the folder order (Alt+↑ / Alt+↓ on the keyboard)" aria-label="Move the ${esc(f.name)} folder">⠿</button><button class="awt" data-fold="${fi}" aria-expanded="${open}" title="${open ? "Close" : "Open"} this folder">${open ? "▾" : "▸"} ${open ? "📂" : "📁"} <b>${esc(f.name)}</b> <span class="mut">${f.idx.length}</span>${on && !open ? ' <span class="onair">● ON SCREEN</span>' : ""}<span class="awtt" title="The award shown on the Live Screen">🏆 ${esc(awTitle(f.name))} ${locChip(f.name)}</span></button><button data-rn="${fi}" title="Edit the folder name and the award shown on screen" aria-label="Edit the ${esc(f.name)} folder">✎</button><button class="d" data-fdel="${fi}" title="Delete this folder and its awardees" aria-label="Delete the ${esc(f.name)} folder">🗑</button>`
          }<button data-fnext="${fi}" ${f.idx.length ? "" : "disabled"} title="Show the next awardee of this award, one by one (the first one if none of them is on screen)">▶ Next in folder</button>${listBtns(f, fi)}</div>` +
          (open && !f.idx.length ? '<div class="mut awempty">Empty folder: pick it under Folder above and add employees.</div>' : "") +
          (open
            ? f.idx
                .map((i, n) => {
                  const a = S.awards[i],
                    act = i === S.spot;
                  return `<div class="row seg awr${act ? " act" : ""}" data-show="${i}" role="button" tabindex="0" aria-pressed="${act}" title="${act ? "On the Live Screen. Click to hide it." : "Click to show on the Live Screen"}"><span class="g"><b>${n + 1}.</b> ${MEDAL[a.medal] ? MEDAL[a.medal][0] + " " : ""}${esc(a.name)}${act ? ' <span class="onair">● ON SCREEN</span>' : ""}</span><select data-med="${i}" title="Medal for ${esc(a.name)}" aria-label="Medal for ${esc(a.name)}">${medalOpts(a.medal)}</select><button data-up="${i}" ${n ? "" : "disabled"} title="Move up">↑</button><button data-dn="${i}" ${n < f.idx.length - 1 ? "" : "disabled"} title="Move down">↓</button><button class="d" data-dl="${i}" title="Delete">✕</button></div>`;
                })
                .join("")
            : "") +
          "</div>"
        );
      }).join("") ||
      (viewLoc() && allFolders().length
        ? `<div class="mut">No folders for ${esc(LOCS[viewLoc()])}. Pick "All locations" under Show folders to see every folder.</div>`
        : seesAll() || !S.awFolders || !S.awFolders.length
        ? '<div class="mut">No folders yet. Name a folder above and press ＋ Create folder, then add employees to it.</div>'
        : `<div class="mut">No folders for ${esc(LOCS[myLoc()] || "your location")} yet. Create one above.</div>`);
  if (al._h !== H) {
    al._h = H;
    al.innerHTML = H;
    const ri = al.querySelector("[data-rnin]");
    if (ri) {
      ri.focus();
      ri.setSelectionRange(ri.value.length, ri.value.length);
    }
  }
  // the form's Folder picker: new awardees go into the picked folder
  const fs = $(r, "#aa"),
    c = curFolder(),
    FH = F.length
      ? F.map((f) => `<option value="${esc(f.name)}" ${f.name === c ? "selected" : ""}>📁 ${esc(f.name)}</option>`).join("")
      : '<option value="">Create a folder first</option>';
  if (fs && fs._h !== FH) {
    fs._h = FH;
    fs.innerHTML = FH;
  }
  if (fs) fs.disabled = !F.length;
  const fl = $(r, "#afl"),
    LH = seesAll() ? locOpts(fl ? fl.value : "") : locOpts(myLoc());
  if (fl && fl._h !== LH + seesAll()) {
    fl._h = LH + seesAll();
    fl.innerHTML = LH;
    fl.disabled = !seesAll();
    fl.title = seesAll() ? "Where this folder is shown" : "Your folders belong to your location";
  }
  const ab = $(r, "#aadd");
  if (ab) ab.disabled = !F.length;
  // the Director's location filter for this list
  const vr = $(r, "#afvr"),
    vs = $(r, "#afv");
  if (vr && vs) {
    vr.hidden = !seesAll();
    const n = (k) => allFolders().filter((f) => !k || !locOf(f.name) || locOf(f.name) === k).length,
      VH =
        `<option value="" ${viewLoc() ? "" : "selected"}>🌐 All locations (${n("")} folders)</option>` +
        Object.entries(LOCS)
          .map(([k, nm]) => `<option value="${k}" ${viewLoc() === k ? "selected" : ""}>📍 ${esc(nm)} (${n(k)} folders)</option>`)
          .join("");
    if (vs._h !== VH) {
      vs._h = VH;
      vs.innerHTML = VH;
    }
    vs.onchange = () => {
      view = vs.value;
      try {
        localStorage.setItem(VKEY, view);
      } catch {}
      renderAwards(r);
    };
  }
  const B = (sel, f) => al.querySelectorAll(sel).forEach(f);
  // rename a folder in place
  B("[data-rn]", (b) => {
    b.onclick = () => {
      const k = F[+b.dataset.rn].name;
      ren = { name: k, text: k, title: awTitle(k) === k ? "" : awTitle(k), loc: locOf(k) };
      renderAwards(r);
    };
  });
  const rnSave = () => {
    const inp = al.querySelector("[data-rnin]"),
      ti = al.querySelector("[data-rtin]");
    if (!ren || !inp) return;
    const from = ren.name;
    const lo = al.querySelector("[data-rlin]"),
      loc = seesAll() ? (lo ? lo.value : ren.loc) : myLoc() || ren.loc;
    if (renameFolder(from, inp.value, ti ? ti.value : "")) {
      const nn = clean(inp.value);
      if (nn) {
        setLoc(nn, loc);
        save();
      }
      ren = null;
      renderAwards(r);
    }
  };
  B("[data-rnin], [data-rtin]", (inp) => {
    inp.oninput = () => ren && (inp.dataset.rtin ? (ren.title = inp.value) : (ren.text = inp.value));
    inp.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        rnSave();
      } else if (e.key === "Escape") {
        ren = null;
        renderAwards(r);
      }
    };
  });
  B("[data-rnok]", (b) => (b.onclick = rnSave));
  B("[data-rlin]", (s) => (s.onchange = () => ren && (ren.loc = s.value)));
  B("[data-rnno]", (b) => {
    b.onclick = () => {
      ren = null;
      renderAwards(r);
    };
  });
  if (ren && !F.some((f) => f.name === ren.name)) ren = null; // the folder was removed meanwhile
  B("[data-fdel]", (b) => (b.onclick = () => deleteFolder(F[+b.dataset.fdel].name)));
  // drag a folder by its ⠿ handle onto another folder: above its middle = before it, below = after it
  const clearDrop = () => al.querySelectorAll(".awf.dropb, .awf.dropa, .awf.dragging").forEach((x) => x.classList.remove("dropb", "dropa", "dragging"));
  B("[data-fdrag]", (h) => {
    const fi = +h.dataset.fdrag;
    h.ondragstart = (e) => {
      dragName = F[fi].name;
      const box = h.closest(".awf");
      box.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragName);
      try {
        e.dataTransfer.setDragImage(box, 20, 20);
      } catch {
        /* older browsers: default image */
      }
    };
    h.ondragend = () => {
      dragName = "";
      clearDrop();
    };
    h.onkeydown = (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const k = F[fi].name;
      if (e.key === "ArrowUp" && fi > 0) moveFolder(k, F[fi - 1].name);
      else if (e.key === "ArrowDown" && fi < F.length - 1) moveFolder(k, F[fi + 2] ? F[fi + 2].name : "");
      requestAnimationFrame(() => al.querySelector(`[data-fdrag="${e.key === "ArrowUp" ? Math.max(0, fi - 1) : Math.min(F.length - 1, fi + 1)}"]`)?.focus());
    };
  });
  B(".awf[data-fi]", (box) => {
    const below = (e) => {
      const b = box.getBoundingClientRect();
      return e.clientY > b.top + b.height / 2;
    };
    box.ondragover = (e) => {
      if (!dragName) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const a = below(e);
      box.classList.toggle("dropa", a);
      box.classList.toggle("dropb", !a);
    };
    box.ondragleave = (e) => {
      if (!box.contains(e.relatedTarget)) box.classList.remove("dropa", "dropb");
    };
    box.ondrop = (e) => {
      if (!dragName) return;
      e.preventDefault();
      const fi = +box.dataset.fi,
        tgt = F[fi].name,
        name = dragName;
      dragName = "";
      clearDrop();
      if (tgt === name) return;
      if (!below(e)) moveFolder(name, tgt);
      else {
        // after the target: before the folder that follows it in the full list
        const all = allFolders().map((f) => f.name).filter((x) => x !== name),
          nx = all[all.indexOf(tgt) + 1] || "";
        moveFolder(name, nx);
      }
    };
  });
  B("[data-fold]", (b) => {
    b.onclick = () => {
      const k = F[+b.dataset.fold].name;
      if (shut.has(k)) shut.delete(k);
      else shut.add(k);
      renderAwards(r);
    };
  });
  B("[data-fnext]", (b) => {
    b.onclick = () => {
      const idx = F[+b.dataset.fnext].idx,
        at = idx.indexOf(S.spot);
      shut.delete(F[+b.dataset.fnext].name);
      show(idx[Math.min(idx.length - 1, at + 1)]);
    };
  });
  const page = (b, d) => {
    const f = F[+b.dataset[d]],
      pages = Math.ceil(f.idx.length / PER),
      L = S.spotList && S.spotList.award === f.name ? S.spotList : null;
    return { f, pages, pg: L ? Math.min(L.page, pages - 1) : -1 };
  };
  B("[data-lst]", (b) => (b.onclick = () => showList(F[+b.dataset.lst].name, 0)));
  B("[data-lnext]", (b) => {
    b.onclick = () => {
      const { f, pages, pg } = page(b, "lnext");
      showList(f.name, Math.min(pages - 1, pg + 1));
    };
  });
  B("[data-lprev]", (b) => {
    b.onclick = () => {
      const { f, pg } = page(b, "lprev");
      showList(f.name, Math.max(0, pg - 1));
    };
  });
  B("[data-ldone]", (b) => {
    b.onclick = () => {
      S.spotList = null;
      save();
    };
  });
  B("[data-show]", (row) => {
    const go = () => {
      const i = +row.dataset.show;
      show(i === S.spot ? -1 : i);
    };
    row.onclick = (e) => {
      if (!e.target.closest("button, select")) go();
    };
    row.onkeydown = (e) => {
      if (e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        go();
      }
    };
  });
  B("[data-med]", (s) => {
    s.onchange = () => {
      const a = S.awards[+s.dataset.med];
      if (a) a.medal = s.value;
      save();
    };
  });
  // move within its folder; the awardee on screen stays on screen
  const mv = (i, d) => {
    const idx = F.find((f) => f.idx.includes(i)).idx,
      j = idx[idx.indexOf(i) + d];
    if (j === undefined) return;
    [S.awards[i], S.awards[j]] = [S.awards[j], S.awards[i]];
    if (S.spot === i) S.spot = j;
    else if (S.spot === j) S.spot = i;
    save();
  };
  B("[data-up]", (b) => (b.onclick = () => mv(+b.dataset.up, -1)));
  B("[data-dn]", (b) => (b.onclick = () => mv(+b.dataset.dn, 1)));
  B("[data-dl]", (b) => {
    b.onclick = () => {
      const i = +b.dataset.dl;
      if (!confirm(`Delete ${S.awards[i].name} (${S.awards[i].award})?`)) return;
      S.awards.splice(i, 1);
      if (S.spot === i) S.spot = -1;
      else if (S.spot > i) S.spot--;
      save();
    };
  });
}
