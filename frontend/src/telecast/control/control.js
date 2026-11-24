/** Control-room page: header, cards, bindings and per-render refresh. */
import { exportBackup, importBackup } from "../persistence.js";
import { $, esc, SCENES, MB, meetLink, meetPlat } from "../constants.js";
import { S, dedupe, segLeft } from "../state.js";
import { LIVE, ownOut, quiet, save, popOut, doAct } from "../sync.js";
import { storeFile, mediaButton } from "../media.js";
import { NET, canControl, renderNet } from "../net.js";
import { startCall, stopCall, sharing, viewers, callLive, canShare } from "../call.js";
import { vidPlaying, startRaf } from "../playback.js";
import { buildStage, updateStage } from "../stage/stage.js";
import { setSeg, spin, stopSfx, pauseShow, resumeShow, restartShow } from "../actions.js";
import { renderRundown } from "./rundown.js";
import { openBulk, refreshBulk } from "./bulk.js";
import { now } from "../clock.js";
import { renderAwards, nextAward, medalOpts } from "./awards.js";
import { renderEditor } from "./editor.js";
import { renderLibrary, renderSfx } from "./library.js";

const togglePlay = () => (S.running ? pauseShow() : resumeShow());
const CUE_MS = 90000; // warn 1 min 30 s before a segment ends
const TITLE = document.title;
/** give the current segment N more minutes, counted from now */
function extend(min) {
  const g = S.segs[S.seg];
  S.segStart = now() - g.min * 60000 + min * 60000;
  save();
}

addEventListener("keydown", (e) => {
  if (LIVE || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName || "")) return;
  if (document.getElementById("login")) return;
  if (e.key === " ") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowRight") setSeg(Math.min(S.segs.length - 1, S.seg + 1));
  else if (e.key === "ArrowLeft") setSeg(Math.max(0, S.seg - 1));
});
function setTx(n, t) {
  if (n._t !== t) {
    n._t = t;
    n.textContent = t;
  }
}
function updNext() {
  const nb = document.getElementById("nxb"),
    rm = document.getElementById("rem");
  if (!nb || !rm) return;
  const nx = S.segs[S.seg + 1],
    left = segLeft(),
    t = Math.max(0, Math.floor(Math.abs(left) / 1000)),
    mm = Math.floor(t / 60),
    ss = t % 60;
  setTx(
    rm,
    "\u23f1 " +
      (left < 0 ? "Time is up \u2014 over by " : "") +
      (mm ? mm + " min " : "") +
      ss +
      " s" +
      (left < 0 ? "" : " remaining in this segment") +
      (S.started && !S.running ? " (paused)" : ""),
  );
  const g = S.segs[S.seg] || {},
    asking = g.endAct !== "next",
    over = S.running && nx && left < 0 && S.hold !== S.segStart;
  // 1:30 cue: the segment is ending
  {
    const cue = document.getElementById("segend"),
      on = S.running && left > 0 && left <= CUE_MS,
      s = Math.ceil(left / 1000);
    if (on) {
      setTx(cue.querySelector("[data-c]"), `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      setTx(cue.querySelector("[data-g]"), `“${g.title}” is ending`);
      setTx(
        cue.querySelector("[data-n]"),
        nx ? `Next: ${nx.title}${asking ? "" : " · starts automatically"}` : "This is the last segment",
      );
      cue.querySelector(".cuebar i").style.width = (100 * left) / CUE_MS + "%";
      cue.querySelector("#cuenx").hidden = !nx;
      cue.classList.toggle("last", s <= 15);
    }
    if (cue.hidden === on) cue.hidden = !on;
    // also in the browser tab, in case this window is behind the meeting
    const t = on ? `⏳ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · ${g.title}` : over && asking ? "⏰ TIME IS UP · " + g.title : TITLE;
    if (document.title !== t) document.title = t;
  }
  // time is up and this segment asks first: pop-up
  {
    const tup = document.getElementById("tup"),
      show = over && asking;
    if (show) {
      setTx(tup.querySelector("[data-tt]"), `“${g.title}” is over by ${mm ? mm + " min " : ""}${ss} s`);
      setTx(tup.querySelector("#tupgo"), `▶ Continue to the next segment: ${nx.title}`);
    }
    if (tup.hidden === show) tup.hidden = !show;
  }
  const pend = over && !asking;
  if (pend) {
    nb.style.display = "flex";
    setTx(
      nb.querySelector("b"),
      "\u23ed Next: " +
        nx.title +
        (vidPlaying()
          ? " \u2014 waiting for the video to finish"
          : " \u2014 starts in " + Math.max(0, Math.ceil((5000 + left) / 1000)) + "s"),
    );
  } else if (nb.style.display !== "none") nb.style.display = "none";
}
function dupTab() {
  if (document.getElementById("dup")) return;
  const d = document.createElement("div");
  d.id = "dup";
  d.textContent =
    "\u26a0 The control room is already open in another tab or window of this browser. Changes made in both can overwrite each other \u2014 please close one.";
  document.body.prepend(d);
}
let clr = 0,
  rst = 0;
/** "gold" / "Silver" / "1st" / "3" -> medal key; "none" / "-" -> ""; anything else -> null (not a medal column) */
function medalOf(t) {
  const x = String(t || "").trim().toLowerCase();
  if (/^(gold|1|1st|first)$/.test(x)) return "gold";
  if (/^(silver|2|2nd|second)$/.test(x)) return "silver";
  if (/^(bronze|3|3rd|third)$/.test(x)) return "bronze";
  if (/^(none|no medal|-)$/.test(x)) return "";
  return null;
}
/* control UI */
function buildControl(r) {
  r.innerHTML = `<div class="aur"></div><header><h1>🎄 VIENOVO TELECAST CONTROL · YEAR END &amp; CHRISTMAS 2026</h1><div class="row"><span id="net" class="row"></span><span class="live-dot"></span><b id="clk" class="tm"></b><span class="mut" id="sv">✔ Auto-saved</span>
 <label class="mut">❄ <select id="snow"><option value="off">Snow off</option><option value="light">Light snow</option><option value="lightd">Light snow (no snowflakes)</option><option value="normal">Snowfall</option><option value="normald">Snowfall (no snowflakes)</option><option value="blizzard">Blizzard</option></select></label><label class="mut"><input type="checkbox" id="mvid"> 🎬 Monitor plays video</label><label class="mut"><input type="checkbox" id="msnd"> 🔊 Sound on this screen too</label><label class="mut"><input type="checkbox" id="auto"> Auto-Pilot (starts segments at their set times)</label><button id="msave" title="Copies every video, song and picture of the show to this computer, so they play from its disk instead of over the network. Do it before the show.">⬇ Save media on this PC</button><button class="p" id="pop">Pop-out Live Screen ↗</button><button id="fs">⛶ Fullscreen preview</button><button id="dlh" class="dir" title="Saves your settings plus any pictures, music or videos uploaded in this browser">💾 Download backup</button><label class="b dir" title="Restore a backup file">📂 Restore backup<input type="file" hidden accept=".json,application/json" id="rbk"></label></div></header>
 <main><section class="card wide"><h2 id="montl">Live program monitor</h2><div class="showctl"><button class="p" id="go"></button><button id="rst" title="Start again from segment 1">⏮ Restart from segment 1</button><span id="shst"></span></div><div id="callbar" class="row callbar"></div><div style="max-width:880px;margin:auto"><div id="prev"></div></div><div class="row" style="justify-content:center"><span id="scenes"></span></div><div id="rem" style="text-align:center;font-weight:700;color:var(--acc);margin-top:6px"></div><div id="nxb" class="row" style="display:none;justify-content:center;padding:8px;border:1px dashed var(--acc);border-radius:12px"><b></b><button class="p" id="nxnow">Start now</button><button id="nxhold">Hold</button></div><div class="mut" id="np" style="text-align:center;min-height:1.3em"></div><div class="row dir" style="justify-content:center;margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:12px"><input id="qprize" placeholder="🎁 Prize for this spin" style="min-width:240px"><button class="p" id="qspin">🎡 Spin</button><button id="qnext">✔ Next round</button></div></section>
 <section class="card"><h2>1 · Rundown &amp; schedule</h2><div id="rd"></div><div class="row"><button id="pv">◀ Prev</button><button class="p" id="nx" title="Finished early? Go straight to the next segment (shortcut: → key)">✔ Finish &amp; next segment ▶</button></div><div class="row"><button id="bulkb" title="Add, replace or remove the same music, videos or photos in many segments (e.g. all three locations) at once">🔁 Change media in many segments</button></div><div class="mut">✎ edits a segment · ▶ takes it live · ✔ Finish &amp; next skips ahead when a segment ends early (or press the → key). With Auto-Pilot, a segment starts at its set clock time. 1 min 30 s before a segment ends you get a warning; when its time is up it asks you (or moves on by itself, if set in the Segment editor).</div></section>
 <section class="card"><h2>2 · Media library</h2><div id="upst" class="mut" style="display:none;padding:6px 8px;border:1px dashed var(--acc);border-radius:10px;margin-bottom:8px"></div><div id="lib"></div></section>
 <section class="card"><h2>3 · Segment editor</h2><div id="ed"></div></section>
 <section class="card"><h2>4 · Sound effects</h2><div id="sfx" class="sfxg"></div><div class="row"><button id="fxstop">⏹ Stop effects</button><label class="mut">🔉 Volume <input type="range" id="fxv" min="0" max="100" step="5"></label><label class="b">⬆ Upload effects<input type="file" hidden multiple accept="audio/*,.mp3,.m4a,.wav,.ogg" data-lup="sfx"></label></div><div class="mut" id="fxhelp">Press an effect to play it once, on top of the music. <b>Only your location hears it</b> (this computer and its pop-out Live Screen); other venues are not affected. Effects are played by hand only: they are not part of any segment.</div></section>
 <section class="card dir"><h2>5 · Ticker</h2><div class="row"><input class="g" id="tk"><button class="p" id="tkb">Broadcast</button></div><h2 style="margin-top:12px">Default live background</h2><div class="row"><label class="b">🖼 Upload default<input type="file" hidden accept="image/*" id="dbg"></label><button id="dbr">Reset to Vienovo winter</button></div><div class="mut">Shown whenever a segment has no picture of its own.</div></section>
 <section class="card dir"><h2>6 · Employee awards</h2><div class="row"><input class="g" id="an" placeholder="Employee name" style="flex-basis:100%"></div><div class="row"><input class="g" id="aa" placeholder="Award (e.g. Sales Awardee)" list="awl"><datalist id="awl"></datalist><select id="amed" title="Medal for this awardee (optional)">${medalOpts("")}</select><button class="p" id="aadd">Add</button></div>
 <textarea id="acsv" placeholder="Paste CSV: Name, Award, Medal (one per line; medal is optional: gold, silver or bronze)"></textarea><div class="row"><button id="aimp">Import CSV</button><button class="p" id="anx">⏭ Next award</button><button id="aoff">Hide spotlight</button><button class="d" id="aclr">Clear all</button></div><div id="al"></div></section>
 <section class="card dir"><h2>7 · Grand raffle</h2><div class="row"><label class="mut g">🎁 Prize for this spin <input id="prize" style="width:100%" placeholder="Type the prize, e.g. Grand Prize: 55-inch 4K Smart TV"></label></div><div class="row"><label class="mut">⏱ Spin time <select id="dur"><option value="0">🎲 Random (10–30 s)</option><option value="10">10 s</option><option value="15">15 s</option><option value="20">20 s</option><option value="25">25 s</option><option value="30">30 s</option><option value="40">40 s</option><option value="60">60 s</option></select></label></div><textarea id="pool" placeholder="Paste participants, one per line"></textarea><div class="row"><button id="psave">Remove duplicates</button><button class="p" id="spin">🎡 Spin</button><button id="wshow">👁 Show wheel on Live Screen</button><button id="whide">🙈 Hide wheel</button><button id="ack">✔ Acknowledge &amp; next round</button><span class="mut" id="pc"></span></div><div class="row"><label class="b">🎵 Raffle music<input type="file" hidden accept="audio/*,video/mp4,.mp3,.m4a,.mp4" id="rmu"></label><span class="mut g" id="rmn"></span><button id="rmr">Reset to default</button></div><div id="wl"></div><button class="d" id="wclr">Clear winners</button></section></main>
 <div id="segend" class="cue" hidden role="status"><div class="cuetop"><span class="cueic">⏳</span><b class="cuec tm" data-c></b><div class="cuetx"><b data-g></b><span data-n></span></div></div><div class="cuebar"><i></i></div><div class="row"><button id="cue1">+1 min</button><button class="p" id="cuenx">Next segment now ▶</button></div></div>
 <div id="tup" hidden role="alertdialog" aria-labelledby="tuph"><h3 id="tuph">⏰ Time is up</h3><div class="mut" data-tt></div><div class="row"><button class="p" id="tupgo"></button></div><div class="row"><button id="tup1">+1 min</button><button id="tup5">+5 min</button><button id="tupstay">Stay on this segment</button></div></div>`;
  buildStage($(r, "#prev"), 0);
  const B = (s, f) => ($(r, s).onclick = f);
  $(r, "#auto").onchange = (e) => {
    S.auto = e.target.checked;
    save();
  };
  $(r, "#msnd").onchange = (e) => {
    S.monSound = e.target.checked;
    save();
  };
  $(r, "#snow").onchange = (e) => {
    S.snow = e.target.value;
    save();
  };
  $(r, "#mvid").onchange = (e) => {
    S.monVid = e.target.checked;
    save();
  };
  $(r, "#dur").onchange = (e) => {
    S.spinSec = +e.target.value;
    save();
  };
  B("#go", togglePlay);
  B("#rst", (e) => {
    if (rst) {
      rst = 0;
      e.target.textContent = "⏮ Restart from segment 1";
      restartShow();
    } else {
      rst = 1;
      e.target.textContent = "Click again to restart";
      setTimeout(() => {
        rst = 0;
        e.target.textContent = "⏮ Restart from segment 1";
      }, 3000);
    }
  });
  B("#fxstop", stopSfx);
  $(r, "#fxv").oninput = (e) => {
    S.sfxVol = +e.target.value / 100;
    quiet();
  };
  B("#pop", popOut);
  B("#bulkb", openBulk);
  mediaButton($(r, "#msave"));
  B("#dlh", exportBackup);
  $(r, "#rbk").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importBackup(f);
  };
  B("#fs", () => {
    const e = $(r, "#prev");
    (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
  });
  B("#pv", () => setSeg(Math.max(0, S.seg - 1)));
  B("#nx", () => setSeg(Math.min(S.segs.length - 1, S.seg + 1)));
  B("#tkb", () => {
    S.ticker = $(r, "#tk").value;
    save();
  });
  $(r, "#dbg").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      S.defBg = await storeFile("d", f);
      save();
    } catch (x) {
      alert("The picture could not be saved.");
    }
  };
  B("#dbr", () => {
    S.defBg = "";
    save();
  });
  B("#aadd", () => {
    const n = $(r, "#an").value.trim();
    if (!n) return;
    S.awards.push({ name: n, award: $(r, "#aa").value.trim() || "Award", medal: $(r, "#amed").value });
    // the award and medal stay filled in, for entering several awardees of the same award one after another
    $(r, "#an").value = "";
    $(r, "#an").focus();
    save();
  });
  B("#aimp", () => {
    for (const l of $(r, "#acsv").value.split(/\r?\n/)) {
      const p = l.split(/[,\t]/).map((x) => x.trim()),
        // optional last column: gold / silver / bronze (or 1st / 2nd / 3rd)
        m = p.length > 2 ? medalOf(p[p.length - 1]) : null;
      if (m !== null) p.pop();
      if (p[0]) S.awards.push({ name: p[0], award: p.slice(1).join(", ") || "Award", medal: m || "" });
    }
    $(r, "#acsv").value = "";
    save();
  });
  B("#aoff", () => {
    S.spot = -1;
    S.spotList = null;
    save();
  });
  B("#anx", nextAward);
  // Enter adds the awardee (a block body: returning false from onkeydown would block typing)
  $(r, "#an").onkeydown = (e) => {
    if (e.key === "Enter") $(r, "#aadd").click();
  };
  B("#aclr", () => {
    if (confirm("Delete all awards?")) {
      S.awards = [];
      S.spot = -1;
      S.spotList = null;
      save();
    }
  });
  B("#psave", () => {
    S.pool = dedupe($(r, "#pool").value).join("\n");
    save();
  });
  B("#spin", () => {
    S.pool = $(r, "#pool").value;
    spin();
  });
  B("#ack", () => {
    S.raffle = null;
    save();
  });
  B("#wshow", () => {
    S.scene = "spin-wheel";
    startRaf();
    save();
  });
  B("#whide", () => doAct("closeWheel"));
  B("#nxnow", () => setSeg(Math.min(S.segs.length - 1, S.seg + 1)));
  B("#tupgo", () => setSeg(Math.min(S.segs.length - 1, S.seg + 1)));
  B("#tup1", () => extend(1));
  B("#cue1", () => extend(1));
  B("#cuenx", () => setSeg(Math.min(S.segs.length - 1, S.seg + 1)));
  B("#tup5", () => extend(5));
  B("#tupstay", () => {
    S.hold = S.segStart; // don't ask again for this segment
    save();
  });
  B("#nxhold", () => {
    S.hold = S.segStart;
    save();
  });
  B("#qspin", () => spin());
  B("#qnext", () => {
    S.raffle = null;
    save();
  });
  $(r, "#qprize").oninput = (e) => {
    S.prize = e.target.value;
    quiet();
  };
  $(r, "#rmu").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const n = $(r, "#rmn");
    n.textContent = "\u23f3 Saving " + f.name + "\u2026";
    try {
      S.rafMusic = await storeFile("rm", f);
      S.rafName = f.name + " (" + MB(f.size) + ") \u2714";
      save();
    } catch (x) {
      n.textContent = "\u26a0 Could not save the file";
    }
  };
  $(r, "#rmr").onclick = () => {
    S.rafMusic = "";
    S.rafName = "";
    save();
  };
  $(r, "#prize").oninput = (e) => {
    S.prize = e.target.value;
    quiet();
  };
  $(r, "#pool").oninput = (e) => {
    S.pool = e.target.value;
    quiet();
    $(r, "#pc").textContent = dedupe(S.pool).length + " in pool";
    updateStage($(r, "#prev"), ownOut());
  };
  B("#wclr", (e) => {
    if (clr) {
      S.winners = [];
      S.raffle = null;
      clr = 0;
      save();
    } else {
      clr = 1;
      e.target.textContent = "Click again to confirm";
      setTimeout(() => {
        clr = 0;
        e.target.textContent = "Clear winners";
      }, 3000);
    }
  });
}
const PLAT = { teams: "Microsoft Teams", meet: "Google Meet", zoom: "Zoom", other: "Meeting" };
/** Live call bar (monitor card): the Director shares the CEO's Teams / Meet / Zoom call to every Live Screen. */
function renderCallBar(r) {
  const bar = $(r, "#callbar"),
    g = S.segs[S.seg] || {},
    c = g.call || {},
    link = meetLink(c.link),
    plat = PLAT[meetPlat(link) || c.platform] || "Meeting",
    open = link ? `<button data-callopen="1" title="${esc(link)}">🔗 Open ${esc(plat)} meeting</button>` : "";
  let H;
  if (canControl()) {
    // remote Live screens (not this computer's own pop-out, which gets the picture directly)
    const screens = NET.on ? NET.users.filter((u) => u.role === "screen" && u.name !== NET.you.name + " (screen)").length : 0,
      rx = viewers(),
      recv = screens
        ? ` · ${rx} of ${screens} Live Screen${screens === 1 ? "" : "s"} receiving${rx < screens ? " (the others keep trying)" : ""}`
        : "";
    H = sharing()
      ? `<span class="st on">📡 CALL ON AIR${recv}${S.call && !S.call.audio ? " · ⚠ no sound shared" : ""}</span>${open}<button class="pause" id="callstop">⏹ Stop sharing the call</button>`
      : `<span class="g mut">📞 <b>Live call</b> ${link ? "· " + esc(plat) + " link set for this segment" : c.link ? "· ⚠ the meeting link in this segment is not valid (fix it in the Segment editor)" : "· no meeting link in this segment (add it in the Segment editor)"}</span>${open}${
          canShare()
            ? `<button class="p" id="callgo" title="Pick the browser tab with the meeting. Tick 'Also share tab audio'.">📡 Share call to Live Screens</button>`
            : `<button class="warnb" id="callgo" title="This address can't share a tab">⚠ Sharing blocked on this address: how to fix</button>`
        }`;
  } else {
    H = callLive()
      ? `<span class="st on">📡 The CEO call is on air (shared by ${esc(S.call.by || "the Director")}). Watch it with “Pop-out Live Screen”.</span>${open}`
      : link
        ? `<span class="g mut">📞 This segment has a ${esc(plat)} call. The Director will share it to the Live Screens. If it doesn't reach your location, open the meeting here.</span>${open}`
        : "";
  }
  if (bar._h !== H) {
    bar._h = H;
    bar.innerHTML = H;
  }
  bar.style.display = H ? "" : "none";
  const o = bar.querySelector("[data-callopen]");
  if (o) o.onclick = () => window.open(link, "_blank", "noopener");
  const go = bar.querySelector("#callgo");
  if (go) go.onclick = startCall;
  const st = bar.querySelector("#callstop");
  if (st) st.onclick = stopCall;
}
function renderControl(r) {
  document.body.classList.toggle("role-editor", !canControl());
  renderNet($(r, "#net"));
  renderCallBar(r);
  refreshBulk();
  {
    const go = $(r, "#go"),
      st = $(r, "#shst"),
      g = S.segs[S.seg],
      state = !S.started ? "idle" : S.running ? "on" : "paused";
    setTx(go, { idle: "▶ Start show", on: "⏸ Pause show", paused: "▶ Resume show" }[state]);
    const mine = !canControl(); // an Editor: this flow runs on this computer only
    go.className = state === "on" ? "pause" : "p";
    $(r, "#rst").style.display = S.started ? "" : "none";
    st.className = "st " + state;
    setTx($(r, "#montl"), mine ? "Your preview (only on this computer, not on the Live screens)" : "Live program monitor");
    setTx(
      st,
      state === "idle"
        ? mine
          ? "Your own flow: press Start to play it here. The Live screens follow the Director only."
          : "Not started: nothing plays until you press Start (or the Space key)."
        : (state === "on" ? (mine ? "● PLAYING HERE" : "● ON AIR") : "⏸ PAUSED") + " · Segment " + (S.seg + 1) + ": " + g.title,
    );
  }
  $(r, "#auto").checked = S.auto;
  $(r, "#msnd").checked = !!S.monSound;
  {
    const q = $(r, "#qprize");
    if (q && document.activeElement !== q) q.value = S.prize || "";
  }
  $(r, "#mvid").checked = S.monVid !== false;
  {
    const n = $(r, "#rmn");
    if (n) n.textContent = S.rafMusic ? S.rafName || "Custom music" : "Default: The Lucky Winner Crown";
  }
  $(r, "#snow").value = S.snow || "normal";
  $(r, "#dur").value = String(S.spinSec || 0);
  {
    const np = $(r, "#np");
    if (np && (!S.cmd || S.cmd.action === "stop")) np.textContent = "";
  }
  $(r, "#scenes").innerHTML = Object.keys(SCENES)
    .map((k) => `<button data-s="${k}" class="${S.scene === k ? "on" : ""}">${SCENES[k]}</button>`)
    .join(" ");
  r.querySelectorAll("#scenes button").forEach(
    (b) =>
      (b.onclick = () => {
        S.scene = b.dataset.s;
        save();
      }),
  );
  renderRundown(r);
  renderLibrary(r);
  renderSfx(r);
  if (document.activeElement !== $(r, "#fxv")) $(r, "#fxv").value = String(Math.round((S.sfxVol ?? 1) * 100));
  {
    const a = document.activeElement;
    if (!r.contains(a) || !(a.dataset.f || a.dataset.cf)) renderEditor(r);
  }
  if (document.activeElement !== $(r, "#tk")) $(r, "#tk").value = S.ticker;
  renderAwards(r);
  if (document.activeElement !== $(r, "#pool")) $(r, "#pool").value = S.pool;
  if (document.activeElement !== $(r, "#prize")) $(r, "#prize").value = S.prize || "";
  $(r, "#pc").textContent = dedupe(S.pool).length + " in pool";
  $(r, "#wl").innerHTML =
    S.winners
      .map(
        (w, i) =>
          `<div>${i + 1}. 🏆 ${esc(w.name)}${w.prize ? ` <span class="mut">· ${esc(w.prize)}</span>` : ""}</div>`,
      )
      .join("") || '<div class="mut">No winners yet.</div>';
}

export { setTx, updNext, dupTab, buildControl, renderControl };
