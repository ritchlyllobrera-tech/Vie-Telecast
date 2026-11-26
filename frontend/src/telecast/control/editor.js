/** Segment editor (card 3): details, plus music / videos / photos picked from the Media library. */
import { $, esc, MB, LOCS, meetLink, meetPlat, ytId } from "../constants.js";
import { NET, canControl, canEditSeg, myLoc, mediaLoc, segList } from "../net.js";
import { S, segYt } from "../state.js";
import { ownOut, quiet, save } from "../sync.js";
import { url } from "../media.js";
import { updateStage } from "../stage/stage.js";
import { cmd, setAll } from "../actions.js";
import { renderRundown, delSeg } from "./rundown.js";
import { libItems, libItem } from "./library.js";
import { xon } from "./select.js";
import { render } from "../render.js";
import { awfMap, foldersFor } from "./awards.js";

const MAX_IMG = 6;
/** the locked folders of each location, with a picker to add more; an Editor only changes their own location's */
function awfRows(g) {
  const m = awfMap(g),
    all = canControl() || !NET.on || !myLoc();
  return Object.entries(LOCS)
    .map(([k, nm]) => {
      const F = foldersFor(k),
        off = !all && k !== myLoc(),
        cur = m[k] || [],
        lock = off ? ` disabled title="Only the ${esc(nm)} Editor or the Director sets this"` : "",
        left = F.filter((f) => !cur.includes(f.name)),
        chips = cur
          .map((n, i) => {
            const f = F.find((x) => x.name === n);
            return `<span class="awfc">📁 ${esc(n)}${f ? ` <span class="mut">${f.idx.length}</span>` : ""}<button class="xs" data-awu="${k}|${i}" ${i ? "" : "disabled"}${lock} title="Move up" aria-label="Move ${esc(n)} up">↑</button><button class="xs d" data-awx="${k}|${i}"${lock} title="Unlock this folder" aria-label="Unlock ${esc(n)}">✕</button></span>`;
          })
          .join("");
      return `<div class="awfrow"><div class="mut">📍 <b>${esc(nm)}</b> <span>${cur.length ? `${cur.length} folder${cur.length > 1 ? "s" : ""}` : "no folder"}</span></div>${chips ? `<div class="awfcs">${chips}</div>` : ""}<select data-awf="${k}" style="width:100%"${lock} ${left.length ? "" : "disabled"}><option value="">${left.length ? "＋ Add a folder…" : F.length ? "All folders added" : "No folders for this location yet"}</option>${left
        .map((f) => `<option value="${esc(f.name)}">📁 ${esc(f.name)} (${f.idx.length})</option>`)
        .join("")}</select></div>`;
    })
    .join("");
}
const PLAT = { teams: "Microsoft Teams", meet: "Google Meet", zoom: "Zoom", other: "Other meeting" };
const bare = (name) => name.replace(/\.[^.]+$/, "");
/** the line under the meeting link: is it a link the Director can open? */
const ytHint = (s) =>
  !String(s || "").trim()
    ? ""
    : ytId(s)
      ? `<span class="okc">✔ YouTube Live link</span>`
      : `<span class="err">✖ Not a YouTube link. Paste the watch / youtu.be / live link of the unlisted live stream.</span>`;
const linkHint = (s) => {
  if (!String(s || "").trim()) return "";
  const u = meetLink(s);
  if (!u) return `<span class="err">⚠ This is not a meeting link. Copy the whole invite link from Teams, Google Meet or Zoom.</span>`;
  return `<span class="okc">✔ ${esc(PLAT[meetPlat(u)] || "Meeting")} link: ${esc(u)}</span>`;
};

/**
 * Location of the segment. The Director can give it to any location; an Editor to their own or back to
 * "All locations". Controls that change another location's segment are disabled for an Editor
 * (playing / previewing stays allowed: that is their own private flow).
 */
const LOCKED = "[data-ml],[data-awf],[data-awx],[data-awu],[data-f],[data-cf],[data-yt],[data-allf],[data-drag],[data-mv],[data-rm],[data-open],[data-segdel]";
function locRow(g) {
  if (!NET.on) return ""; // working alone: locations don't matter
  const mine = myLoc(),
    keys = canControl() ? Object.keys(LOCS) : [mine, g.loc].filter((k, i, a) => k && LOCS[k] && a.indexOf(k) === i),
    opts =
      `<option value="">🌐 All locations</option>` +
      keys.map((k) => `<option value="${k}" ${g.loc === k ? "selected" : ""}>📍 ${esc(LOCS[k])}</option>`).join("");
  const note = !canEditSeg(g)
    ? `<span class="lockm">🔒 This is ${esc(LOCS[g.loc] || g.loc)}'s segment. Only ${esc(LOCS[g.loc] || g.loc)} or the Director can change it; you can still preview it.</span>`
    : g.loc && g.loc === mine
      ? `<span class="okc">✔ Your location's segment</span>`
      : !g.loc
        ? `<span class="mut">Shared by all locations</span>`
        : "";
  return `<div class="row locrow"><label class="mut">Belongs to <select data-f="loc">${opts}</select></label>${note}</div>`;
}

/* multi-select picker state: which list is open, and what is ticked in it */
let openKind = "",
  openSeg = -1;
const picked = new Set();
const ICON = { aud: "🎵", vid: "🎬", img: "🖼" };

/** "+ Add from library" button; when open, a checklist of the items of this kind not yet in the segment. */
function picker(g, kind, label, room) {
  const free = libItems(kind).filter((m) => !g[kind].includes(m.id));
  if (room <= 0) return `<div class="mut">Maximum of ${MAX_IMG} photos per segment.</div>`;
  if (!free.length)
    return `<div class="mut">${libItems(kind).length ? "Everything in the library is already added." : "Nothing in the Media library yet. Upload there first."}</div>`;
  if (openKind !== kind || openSeg !== S.edit)
    return `<button class="pick" data-open="${kind}">＋ ${label}… <span class="mut">(${free.length} available)</span></button>`;
  const n = free.filter((m) => picked.has(m.id)).length,
    lim = room < Infinity ? ` <span class="mut">· up to ${room} more</span>` : "";
  return `<div class="pickp"><div class="row"><b class="g">${label}${lim}</b><button data-pall="1">Select all</button><button data-pnone="1">Clear</button></div>
 <div class="pickl">${free
   .map(
     (m) =>
       `<label class="pki${picked.has(m.id) ? " on" : ""}"><input type="checkbox" data-pk="${esc(m.id)}" ${picked.has(m.id) ? "checked" : ""}>${kind === "img" ? `<img class="lth" data-u="${esc(m.id)}" alt="">` : ICON[kind]} <span class="g">${esc(bare(m.name))}</span><span class="mut">${m.size ? MB(m.size) : ""}</span></label>`,
   )
   .join("")}</div>
 <div class="row"><button class="p" data-padd="1" ${n ? "" : "disabled"}>＋ Add selected (${n})</button><button data-pcancel="1">Cancel</button><span class="mut" data-pmsg></span></div></div>`;
}

/* ---------- media locked to a location ----------
 * The Director (or anyone working alone) sees every item and can lock each one to a location.
 * An Editor sees the items for their location and for all locations; what they add is locked to their location,
 * and they can only switch an item between their location and all locations. */
const SHORTL = { cebu: "Cebu", ncr: "NCR", cdo: "CDO" };
const edAll = () => canControl() || !NET.on || !myLoc();
/** the items of list k this computer shows in the editor */
const edList = (g, k) => (edAll() ? g[k] : segList(g, k, myLoc()));
/** location picker for item `id` of segment g */
function locSel(g, kind, id) {
  const v = (g.mloc || {})[id] || "",
    opts = edAll() ? ["", ...Object.keys(LOCS)] : ["", myLoc()];
  return `<select class="mlsel${v ? " l-" + v : ""}" data-ml="${esc(id)}" title="Where this ${kind === "aud" ? "song" : kind === "vid" ? "video" : "photo"} plays" aria-label="Location">${opts
    .map((k) => `<option value="${k}" ${k === v ? "selected" : ""}>${k ? "📍 " + esc(SHORTL[k] || LOCS[k]) : "🌐 All"}</option>`)
    .join("")}</select>`;
}
/** reorder / remove buttons for an item in one of the segment's lists */
const tools = (kind, id, i, n) =>
  `<button data-mv="${esc(kind)}|${esc(id)}|-1" ${i ? "" : "disabled"} title="Move up">▲</button><button data-mv="${esc(kind)}|${esc(id)}|1" ${i < n - 1 ? "" : "disabled"} title="Move down">▼</button><button class="d xs" data-rm="${esc(kind)}|${esc(id)}" title="Remove from this segment (stays in the library)">✕</button>`;

/** The segment settings drawer (the editor lives in a slide-in panel next to the rundown). */
const curPanel = () => document.body.dataset.panel || "";
const openPanel = (p) => {
  document.body.dataset.panel = p || "";
  document.dispatchEvent(new Event("vtc-panel")); // the control page syncs the title and the rail
};
const setDrawer = (on) => openPanel(on ? "ed" : "");
const drawerOpen = () => !!curPanel();
function renderEditor(r) {
  const g = S.segs[S.edit],
    items = (k) => edList(g, k).map(libItem).filter(Boolean),
    im = items("img"),
    au = items("aud"),
    vi = items("vid");
  const ed = $(r, "#ed"),
    H = `<div class="row"><b>Segment ${S.edit + 1}</b>${g.editedBy ? `<span class="mut">✏ last edited by ${esc(g.editedBy)}${LOCS[g.editedLoc] ? " (" + esc(LOCS[g.editedLoc]) + ")" : ""} at ${new Date(g.editedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>` : ""}</div>${locRow(g)}<input class="g" style="width:100%" data-f="title" value="${esc(g.title)}" placeholder="Title"><textarea data-f="desc" placeholder="Description (shown on the live screen)">${esc(g.desc)}</textarea>
 <div class="row"><label class="mut">Start time <input type="time" data-f="time" value="${esc(g.time)}"></label><label class="mut">Duration <input class="num" type="number" min="0" max="600" step="0.01" data-f="min" value="${esc(g.min)}"> min</label></div>
 <h2 style="margin-top:10px">📡 All sites</h2>
 <div class="row"><label class="mut"><input type="checkbox" data-allf="1" ${g.all ? "checked" : ""} ${canControl() && NET.on ? "" : "disabled"}> Play this segment on <b>every site</b> (Cebu and all Editor screens) when the Director presses ▶. Off: only Cebu.</label></div>
 <h2 style="margin-top:10px">📺 YouTube Live (unlisted)</h2>
 ${
   canControl()
     ? `<div class="row"><input class="g" data-yt="1" placeholder="Paste the YouTube Live link (https://www.youtube.com/watch?v=…)" value="${esc(g.yt || (g.call?.platform === "youtube" ? g.call.link : "") || "")}"></div>
 <div class="mut" data-yh>${ytHint(g.yt || (g.call?.platform === "youtube" ? g.call.link : ""))}</div>`
     : `<div class="mut">🔒 Only the Director can set the YouTube Live link. ${segYt(g) ? "✔ This segment has a YouTube Live stream." : "No YouTube Live link in this segment."}</div>`
 }
 <div class="mut">When this segment goes live (▶), every Live Screen plays the YouTube stream by itself in the video area. Moving to another segment stops it. The videos below stay as a backup.</div>
 <h2 style="margin-top:10px">Videos for the live screen</h2>${vi.map((m, i) => `<div class="row${xon("ed:vid:" + m.id)}" data-sel="ed:vid:${esc(m.id)}"><span class="g">🎬 ${esc(bare(m.name))} <span class="mut">${m.size ? MB(m.size) : ""}</span></span>${locSel(g, "vid", m.id)}<button class="p" data-pv="${esc(m.id)}">▶ Live</button><button data-tg="vid">⏯</button><button data-st="1">⏹</button>${tools("vid", m.id, i, vi.length)}</div>`).join("")}
 <div class="row">${picker(g, "vid", "Add videos from library", Infinity)}</div>
 <h2 style="margin-top:10px">Music playlist (plays in this order)</h2>${au.length ? `<div class="row"><button class="p" data-pa="1">▶ Play all</button><button data-tg="aud">⏯</button><button data-st="1">⏹</button><label class="mut"><input type="checkbox" data-f="loop" ${g.loop ? "checked" : ""}> 🔁 Keep playing (repeat the playlist)</label></div>` : ""}${au.map((m, i) => `<div class="row${xon("ed:aud:" + m.id)}" data-sel="ed:aud:${esc(m.id)}"><span class="g">${i + 1}. 🎵 ${esc(bare(m.name))} <span class="mut">${m.size ? MB(m.size) : ""}</span></span>${locSel(g, "aud", m.id)}<button data-pa="${esc(m.id)}" title="Play this song">▶</button>${tools("aud", m.id, i, au.length)}</div>`).join("")}
 <div class="row">${picker(g, "aud", "Add songs from library", Infinity)}</div>
 <h2 style="margin-top:10px">Backgrounds (${im.length}/${MAX_IMG}): click a picture to show it on the Live Screen (click again for the default)</h2>${im.map((m) => `<span class="th${xon("ed:img:" + m.id)}" data-sel="ed:img:${esc(m.id)}"><img data-u="${esc(m.id)}" data-bg="${esc(m.id)}" class="${S.bgId === m.id ? "sel" : ""}" alt="" title="${esc(m.name)}"><button class="x d xs" data-rm="img|${esc(m.id)}" title="Remove from this segment">✕</button>${locSel(g, "img", m.id)}</span>`).join("")}
 <div class="row">${picker(g, "img", "Add photos from library", MAX_IMG - im.length)}</div>
 <h2 style="margin-top:10px">🏆 Awards folder</h2>
 <div class="mut">Lock the folders each location uses in this segment (as many as you need). While the segment is on, that location's control room shows them under the monitor.</div>
 ${awfRows(g)}
 <h2 style="margin-top:10px">Autoplay &amp; timing</h2>
 <div class="row"><label class="mut"><input type="checkbox" data-f="am" ${g.am !== false ? "checked" : ""}> 🎵 Auto-play its music when this segment starts</label></div>
 <div class="row"><label class="mut"><input type="checkbox" data-f="av" ${g.av ? "checked" : ""}> 🎬 Auto-play its first video when this segment starts</label></div>
 <div class="row"><label class="mut">⏰ When its time is up <select data-f="endAct"><option value="ask" ${g.endAct !== "next" ? "selected" : ""}>Ask me with a pop-up</option><option value="next" ${g.endAct === "next" ? "selected" : ""}>Go to the next segment automatically</option></select></label></div>
 <div class="row"><label class="mut"><input type="checkbox" data-f="an" ${g.an ? "checked" : ""}> ⏭ When its video or music finishes, go to the next segment automatically</label></div>
 <h2 style="margin-top:10px">📞 Live call (Teams / Google Meet / Zoom)</h2>
 ${
   canControl()
     ? `<div class="row"><select data-cf="platform">${Object.entries(PLAT)
   .map(([k, v]) => `<option value="${k}" ${(g.call?.platform || "teams") === k ? "selected" : ""}>${v}</option>`)
   .join(
     "",
   )}</select><input class="g" data-cf="link" placeholder="Paste the meeting link (https://…)" value="${esc(g.call?.link || "")}"></div>
 <div class="mut" data-lh>${linkHint(g.call?.link)}</div>
 <div class="mut">For a live speech (e.g. the CEO): when this segment is on air, the Director opens the meeting in a Chrome / Edge tab and presses “📡 Share call to Live Screens”. Every location sees and hears it.</div>`
     : `<div class="mut">🔒 Only the Director can set and play the meeting link. ${meetLink(g.call?.link) ? "✔ This segment has a " + esc(PLAT[meetPlat(g.call.link)] || "meeting") + " call; the Director will put it on the Live Screens." : "No meeting link in this segment."}</div>`
 }
 <h2 style="margin-top:10px">Delete</h2>
 <div class="row"><button class="d" data-segdel="1" ${S.segs.length <= 1 || (S.edit === S.seg && S.started) ? `disabled title="${S.segs.length <= 1 ? "The rundown needs at least one segment" : "This segment is on air. Move to another segment first."}"` : 'title="Delete this segment from the rundown"'}>🗑 Delete segment</button></div>`;
  if (ed._h !== H) {
    const sc = ed.querySelector(".pickl")?.scrollTop || 0;
    ed._h = H;
    ed.innerHTML = H;
    ed.querySelectorAll("[data-u]").forEach(async (i) => (i.src = await url(i.dataset.u)));
    if (!canEditSeg(g)) ed.querySelectorAll(LOCKED).forEach((x) => (x.disabled = true));
    const pl = ed.querySelector(".pickl");
    if (pl) pl.scrollTop = sc;
  }
  {
    // locked folders: add one, unlock one, move one up (the panel lists them in this order)
    const setAwf = (k, f) => {
      const g = S.segs[S.edit],
        m = awfMap(g);
      m[k] = f(m[k] || []);
      if (!m[k].length) delete m[k];
      g.awf = m;
      quiet();
      render();
    };
    ed.querySelectorAll("[data-awf]").forEach((x) => {
      x.onchange = () => x.value && setAwf(x.dataset.awf, (l) => (l.includes(x.value) ? l : [...l, x.value]));
    });
    ed.querySelectorAll("[data-awx]").forEach((b) => {
      const [k, i] = b.dataset.awx.split("|");
      b.onclick = () => setAwf(k, (l) => l.filter((_, j) => j !== +i));
    });
    ed.querySelectorAll("[data-awu]").forEach((b) => {
      const [k, i] = b.dataset.awu.split("|");
      b.onclick = () =>
        setAwf(k, (l) => {
          const a = [...l];
          [a[+i - 1], a[+i]] = [a[+i], a[+i - 1]];
          return a;
        });
    });
  }
  ed.querySelectorAll("[data-f]").forEach((x) => {
    const f = x.dataset.f,
      h = () => {
        const g = S.segs[S.edit]; // fresh: another user's change may have replaced the object while typing
        g[f] = x.type === "checkbox" ? x.checked : f === "min" ? Math.max(0, +x.value || 0) : x.value;
        quiet();
        renderRundown(r);
        updateStage($(r, "#prev"), ownOut());
      };
    x.oninput = h;
    x.onchange = h;
  });
  {
    const b = ed.querySelector("[data-segdel]");
    if (b)
      b.onclick = () => {
        const g = S.segs[S.edit];
        if (confirm(`Delete segment ${S.edit + 1} “${g.title}” from the rundown? Its music, videos and photos stay in the Media library.`))
          delSeg(S.edit);
      };
  }
  ed.querySelectorAll("[data-yt]").forEach((x) => {
    x.oninput = x.onchange = () => {
      const g = S.segs[S.edit],
        had = !!segYt(g);
      g.yt = x.value.trim();
      if (!had && segYt(g) && g.all === undefined && canControl() && NET.on) g.all = true; // a live segment goes to all sites unless the Director turns it off
      const cb = ed.querySelector("[data-allf]");
      if (cb) cb.checked = !!g.all; // (the editor is not redrawn while this field has the focus)
      if (g.call && g.call.platform === "youtube") g.call = { ...g.call, platform: "teams", link: "" }; // the old entry is now this field
      const h = ed.querySelector("[data-yh]");
      if (h) h.innerHTML = ytHint(g.yt);
      quiet();
      renderRundown(r);
      render();
    };
  });
  ed.querySelectorAll("[data-allf]").forEach(
    (x) =>
      (x.onchange = () => {
        setAll(S.edit, x.checked);
        renderRundown(r);
      }),
  );
  ed.querySelectorAll("[data-cf]").forEach((x) => {
    x.oninput = x.onchange = () => {
      const g = S.segs[S.edit];
      g.call = { platform: "teams", link: "", ...g.call, [x.dataset.cf]: x.value.trim() };
      if (x.dataset.cf === "link") {
        // the platform follows the link (a Google Meet link under "Microsoft Teams" is confusing)
        const p = meetPlat(g.call.link);
        if (p) {
          g.call.platform = p;
          const sel = ed.querySelector('[data-cf="platform"]');
          if (sel) sel.value = p;
        }
      }
      const h = ed.querySelector("[data-lh]");
      if (h) h.innerHTML = linkHint(g.call.link);
      quiet();
      r.querySelector("#callbar")._h = null;
      render(); // the call bar (Share / Show YouTube button) follows the platform and link
    };
  });
  // multi-select picker
  const free = () => libItems(openKind).filter((m) => !g[openKind].includes(m.id)),
    room = () => (openKind === "img" ? MAX_IMG - edList(g, "img").length : Infinity),
    close = () => {
      openKind = "";
      picked.clear();
    };
  ed.querySelectorAll("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        picked.clear();
        openKind = b.dataset.open;
        openSeg = S.edit;
        renderEditor(r);
      }),
  );
  ed.querySelectorAll("[data-pk]").forEach(
    (c) =>
      (c.onchange = () => {
        if (c.checked && picked.size >= room()) {
          c.checked = false;
          const m = ed.querySelector("[data-pmsg]");
          if (m) m.textContent = `Only ${room()} more photo(s) fit in this segment.`;
          return;
        }
        if (c.checked) picked.add(c.dataset.pk);
        else picked.delete(c.dataset.pk);
        renderEditor(r);
      }),
  );
  const pall = ed.querySelector("[data-pall]");
  if (pall)
    pall.onclick = () => {
      free()
        .slice(0, room())
        .forEach((m) => picked.add(m.id));
      renderEditor(r);
    };
  const pnone = ed.querySelector("[data-pnone]");
  if (pnone)
    pnone.onclick = () => {
      picked.clear();
      renderEditor(r);
    };
  const pcancel = ed.querySelector("[data-pcancel]");
  if (pcancel)
    pcancel.onclick = () => {
      close();
      renderEditor(r);
    };
  const padd = ed.querySelector("[data-padd]");
  if (padd)
    padd.onclick = () => {
      // keep the library order, which is the upload order
      const add = free()
        .filter((m) => picked.has(m.id))
        .slice(0, room())
        .map((m) => m.id);
      g[openKind].push(...add);
      if (!edAll()) g.mloc = { ...(g.mloc || {}), ...Object.fromEntries(add.map((id) => [id, myLoc()])) };
      close();
      save();
    };
  ed.querySelectorAll("[data-mv]").forEach(
    (b) =>
      (b.onclick = () => {
        const [k, id, d] = b.dataset.mv.split("|"),
          a = g[k],
          vis = edList(g, k),
          o = vis[vis.indexOf(id) + +d];
        if (!o) return;
        const i = a.indexOf(id),
          j = a.indexOf(o);
        [a[i], a[j]] = [a[j], a[i]];
        save();
      }),
  );
  ed.querySelectorAll("[data-rm]").forEach(
    (b) =>
      (b.onclick = () => {
        const [k, id] = b.dataset.rm.split("|");
        g[k] = g[k].filter((x) => x !== id);
        if (g.mloc && g.mloc[id] && !["aud", "vid", "img"].some((kk) => g[kk].includes(id))) {
          const m = { ...g.mloc };
          delete m[id];
          g.mloc = m;
        }
        if (k === "img" && S.bgId === id) S.bgId = "";
        save();
      }),
  );
  ed.querySelectorAll("[data-bg]").forEach(
    (i) =>
      (i.onclick = () => {
        S.bgId = S.bgId === i.dataset.bg ? "" : i.dataset.bg;
        save();
      }),
  );
  ed.querySelectorAll("[data-ml]").forEach((x) => {
    x.onclick = (e) => e.stopPropagation();
    x.onchange = () => {
      const g = S.segs[S.edit],
        m = { ...(g.mloc || {}) };
      if (LOCS[x.value]) m[x.dataset.ml] = x.value;
      else delete m[x.dataset.ml];
      g.mloc = m;
      save();
    };
  });
  ed.querySelectorAll("[data-pa]").forEach(
    (b) =>
      (b.onclick = () => {
        const ids = au.map((m) => m.id); // ▶ on one song: start there, then carry on through the playlist
        cmd("aud", "play", ids, b.dataset.pa === "1" ? 0 : Math.max(0, ids.indexOf(b.dataset.pa)));
      }),
  );
  ed.querySelectorAll("[data-pv]").forEach((b) => (b.onclick = () => cmd("vid", "play", [b.dataset.pv])));
  ed.querySelectorAll("[data-tg]").forEach((b) => (b.onclick = () => cmd(b.dataset.tg, "toggle")));
  ed.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => cmd("aud", "stop")));
}

export { renderEditor, setDrawer, drawerOpen, openPanel, curPanel };
