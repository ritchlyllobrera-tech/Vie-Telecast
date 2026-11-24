/** Employee awards list (card 6): awardees in one folder per award; click an awardee to put them on the Live Screen. */
import { $, esc, MEDAL } from "../constants.js";
import { S } from "../state.js";
import { save } from "../sync.js";
import { now } from "../clock.js";

/** folders closed on this computer (by award name) */
const shut = new Set();

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

export function renderAwards(r) {
  const al = $(r, "#al"),
    F = folders(),
    H =
      F.map((f, fi) => {
        const open = !shut.has(f.name),
          on = f.idx.includes(S.spot);
        return (
          `<div class="awf${on ? " on" : ""}"><div class="awh"><button class="awt" data-fold="${fi}" aria-expanded="${open}" title="${open ? "Close" : "Open"} this folder">${open ? "▾" : "▸"} ${open ? "📂" : "📁"} <b>${esc(f.name)}</b> <span class="mut">${f.idx.length}</span>${on && !open ? ' <span class="onair">● ON SCREEN</span>' : ""}</button><button data-fnext="${fi}" title="Show the next awardee of this award (the first one if none of them is on screen)">▶ Next in folder</button></div>` +
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
  }
  // the Award box suggests the existing folders, so a new awardee lands in the right one
  const dl = $(r, "#awl"),
    DH = F.map((f) => `<option value="${esc(f.name)}"></option>`).join("");
  if (dl && dl._h !== DH) {
    dl._h = DH;
    dl.innerHTML = DH;
  }
  const B = (sel, f) => al.querySelectorAll(sel).forEach(f);
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
