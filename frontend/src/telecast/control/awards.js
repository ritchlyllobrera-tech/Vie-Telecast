/** Employee awards list (card 6): awardees in one folder per award; click an awardee to put them on the Live Screen. */
import { $, esc, MEDAL, PER } from "../constants.js";
import { S } from "../state.js";
import { save } from "../sync.js";
import { now } from "../clock.js";

/** folders closed on this computer (by award name) */
const shut = new Set();
/** the folder being renamed on this computer: { name, text } (text = what is typed so far) */
let ren = null;

/** rename award folder `from` to `to`: every awardee in it moves to the new award name */
function renameFolder(from, to) {
  to = to.trim().replace(/\s+/g, " ");
  if (!to || to === from) return true;
  const into = S.awards.some((a) => (a.award || "Award") === to);
  if (into && !confirm(`There is already a folder "${to}". Move the awardees of "${from}" into it?`)) return false;
  for (const a of S.awards) if ((a.award || "Award") === from) a.award = to;
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

/** awards grouped by award name, folders in order of first appearance: [{ name, idx: [award indexes] }] */
function folders() {
  const m = new Map();
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

/** buttons for showing all of a folder's names, PER at a time (only for folders with more than PER awardees) */
function listBtns(f, fi) {
  if (f.idx.length <= PER) return "";
  const pages = Math.ceil(f.idx.length / PER),
    L = S.spotList && S.spotList.award === f.name ? S.spotList : null;
  if (!L) return `<button data-lst="${fi}" title="Show all of this award's awardees on the Live Screen, ${PER} names at a time; Next shows the rest">📋 Show all names</button>`;
  const pg = Math.min(L.page, pages - 1),
    from = pg * PER + 1,
    to = Math.min(f.idx.length, from + PER - 1);
  return (
    `<span class="onair" title="Names ${from} to ${to} of ${f.idx.length} are on the Live Screen">● ${from}–${to} of ${f.idx.length}</span>` +
    `<button data-lprev="${fi}" ${pg ? "" : "disabled"} title="Show the previous ${PER} names">◀ Back</button>` +
    (pg < pages - 1
      ? `<button class="p" data-lnext="${fi}" title="Show the next ${PER} names">Next ${PER} ▶</button>`
      : `<button class="p" data-ldone="${fi}" title="That was the last page: hide the list">✔ Done</button>`)
  );
}

export function renderAwards(r) {
  const al = $(r, "#al"),
    F = folders(),
    H =
      F.map((f, fi) => {
        const open = !shut.has(f.name),
          on = f.idx.includes(S.spot) || !!(S.spotList && S.spotList.award === f.name);
        return (
          `<div class="awf${on ? " on" : ""}"><div class="awh">${
            ren && ren.name === f.name
              ? `<span class="awt awren">${open ? "📂" : "📁"} <input class="g" data-rnin="${fi}" value="${esc(ren.text)}" aria-label="New name for the ${esc(f.name)} folder" maxlength="120"><button class="p" data-rnok="${fi}" title="Save the new name (Enter)">✔ Save</button><button data-rnno="1" title="Keep the old name (Esc)">Cancel</button></span>`
              : `<button class="awt" data-fold="${fi}" aria-expanded="${open}" title="${open ? "Close" : "Open"} this folder">${open ? "▾" : "▸"} ${open ? "📂" : "📁"} <b>${esc(f.name)}</b> <span class="mut">${f.idx.length}</span>${on && !open ? ' <span class="onair">● ON SCREEN</span>' : ""}</button><button data-rn="${fi}" title="Rename this folder (the award name of everyone in it)" aria-label="Rename the ${esc(f.name)} folder">✎</button>`
          }<button data-fnext="${fi}" title="Show the next awardee of this award, one by one (the first one if none of them is on screen)">▶ Next in folder</button>${listBtns(f, fi)}</div>` +
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
      }).join("") || '<div class="mut">No awards yet. Add them in program order; each award gets its own folder.</div>';
  if (al._h !== H) {
    al._h = H;
    al.innerHTML = H;
    const ri = al.querySelector("[data-rnin]");
    if (ri) {
      ri.focus();
      ri.setSelectionRange(ri.value.length, ri.value.length);
    }
  }
  // the Award box suggests the existing folders, so a new awardee lands in the right one
  const dl = $(r, "#awl"),
    DH = F.map((f) => `<option value="${esc(f.name)}"></option>`).join("");
  if (dl && dl._h !== DH) {
    dl._h = DH;
    dl.innerHTML = DH;
  }
  const B = (sel, f) => al.querySelectorAll(sel).forEach(f);
  // rename a folder in place
  B("[data-rn]", (b) => {
    b.onclick = () => {
      const k = F[+b.dataset.rn].name;
      ren = { name: k, text: k };
      renderAwards(r);
    };
  });
  const rnSave = () => {
    const inp = al.querySelector("[data-rnin]");
    if (!ren || !inp) return;
    const from = ren.name;
    if (renameFolder(from, inp.value)) {
      ren = null;
      renderAwards(r);
    }
  };
  B("[data-rnin]", (inp) => {
    inp.oninput = () => ren && (ren.text = inp.value);
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
  B("[data-rnno]", (b) => {
    b.onclick = () => {
      ren = null;
      renderAwards(r);
    };
  });
  if (ren && !F.some((f) => f.name === ren.name)) ren = null; // the folder was removed meanwhile
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
