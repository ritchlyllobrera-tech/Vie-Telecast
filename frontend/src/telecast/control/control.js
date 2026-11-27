/** Control-room page: header, cards, bindings and per-render refresh. */
import { exportBackup, importBackup } from "../persistence.js";
import { $, esc, SCENES, MB, LOCS, meetLink, meetPlat } from "../constants.js";
import { S, dedupe, cleanList, MAXN, segLeft, segYt, ytOn, rafLoc, poolText, setPool, prizeText, setPrize, locWinners } from "../state.js";
import { LIVE, ownOut, quiet, save, popOut, doAct } from "../sync.js";
import { storeFile, mediaButton } from "../media.js";
import { NET, canControl, renderNet, myLoc, segList } from "../net.js";
import { startCall, stopCall, sharing, viewers, callLive, canShare } from "../call.js";
import { vidPlaying, startRaf } from "../playback.js";
import { buildStage, updateStage } from "../stage/stage.js";
import { setSeg, cmd, playYt, stopYt, endBc, spin, stopSfx, pauseShow, resumeShow, restartShow } from "../actions.js";
import { renderRundown } from "./rundown.js";
import { openBulk, refreshBulk } from "./bulk.js";
import { now } from "../clock.js";
import { renderAwards, nextAward, medalOpts, createFolder, setCurFolder, renderSegFolder, segFolder } from "./awards.js";
import { renderEditor, setDrawer, drawerOpen, openPanel, curPanel } from "./editor.js";
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
let rst = 0;
/* control UI */
function buildControl(r) {
  r.innerHTML = `<div class="aur"></div><header id="top"><button id="sidet" title="Show the rundown" aria-label="Show the rundown">☰ Rundown</button><div class="brand"><span class="bmark">🎄</span><div><h1>VIENOVO TELECAST</h1><small>Control room · Year End &amp; Christmas 2026</small></div></div><span id="net" class="row"></span><div class="showctl"><button class="p" id="go"></button><button id="rst" title="Start again from segment 1">⏮ Restart</button><span id="shst"></span></div><span class="sp"></span><b id="clk" class="tm"></b><span class="live-dot"></span><span class="mut" id="sv">✔ Auto-saved</span><button class="p" id="pop">Pop-out Live Screen ↗</button><button id="fs" title="Fullscreen preview of the monitor">⛶<span class="lbl"> Fullscreen</span></button></header>
 <aside id="side" aria-label="Rundown"><div class="shead"><h2 title="✎ edits a segment · ▶ takes it live · ✔ Finish &amp; next skips ahead when a segment ends early (or press the → key). With Auto-Pilot, a segment starts at its set clock time. 1 min 30 s before a segment ends you get a warning; when its time is up it asks you (or moves on by itself, if set in the Segment editor).">Rundown</h2><button id="sidec" title="Hide / show the segment list" aria-label="Hide or show the segment list">«</button></div><div id="rd"></div><div class="sfoot"><button id="pv">◀ Prev</button><button class="p g" id="nx" title="Finished early? Go straight to the next segment (shortcut: → key)">✔ Finish &amp; next ▶</button><button id="bulkb" title="Add, replace or remove the same music, videos or photos in many segments (e.g. all three locations) at once">🔁 Bulk media</button></div></aside>
 <main id="center"><section id="mon"><div class="monh"><h2 id="montl">Live program monitor</h2><span class="mut" id="np"></span></div><div id="callbar" class="row callbar"></div><div id="prevwrap"><div id="prev"></div></div><div class="below"><div class="row scn"><span id="scenes"></span></div><div class="row tmr"><span id="rem"></span></div><div id="nxb" class="row"><b></b><button class="p" id="nxnow">Start now</button><button id="nxhold">Hold</button></div><div id="quick" class="row" hidden><span id="qwheel" class="row" hidden><input id="qprize" placeholder="🎁 Prize for this spin"><button class="p" id="qspin">🎡 Spin</button><button id="qnext">✔ Next round</button></span><span id="qaw" class="row" hidden><button class="p" id="qanx">⏭ Next award</button></span><div id="qfold" hidden></div></div></div></section></main>
 <nav id="rail" aria-label="Tools"><button data-panel="lib" title="Media library"><i>🎞</i><span>Media</span><em class="bdg" id="bg-lib"></em></button><button data-panel="sfx" title="Sound effects"><i>🔊</i><span>Effects</span></button><button data-panel="tk" title="Ticker &amp; default live background"><i>📰</i><span>Ticker</span></button><button data-panel="aw" title="Employee awards"><i>🏅</i><span>Awards</span><em class="bdg" id="bg-aw"></em></button><button data-panel="raf" title="Grand raffle"><i>🎡</i><span>Raffle</span><em class="bdg" id="bg-raf"></em></button><button data-panel="ed" title="Segment editor"><i>✎</i><span>Segment</span></button><span class="sp"></span><button data-panel="set" title="Show settings, snow, backup"><i>⚙</i><span>Settings</span></button></nav>
 <aside id="drawer" aria-labelledby="dtitle"><div class="dhead"><b id="dtitle">Segment settings</b><button id="dclose" title="Close (Esc)" aria-label="Close">✕</button></div><div class="dbody">
 <section class="dpanel" data-p="lib"><div id="upst" class="mut" style="display:none;padding:6px 8px;border:1px dashed var(--acc);border-radius:10px;margin-bottom:8px"></div><div id="lib"></div></section>
 <section class="dpanel" data-p="sfx"><div id="sfx" class="sfxg"></div><div class="row"><button id="fxstop">⏹ Stop effects</button><label class="mut">🔉 Volume <input type="range" id="fxv" min="0" max="100" step="5"></label><label class="b">⬆ Upload effects<input type="file" hidden multiple accept="audio/*,.mp3,.m4a,.wav,.ogg" data-lup="sfx"></label></div><div class="mut" id="fxhelp">Press an effect to play it once, on top of the music. <b>Only your location hears it</b> (this computer and its pop-out Live Screen); other venues are not affected. Effects are played by hand only: they are not part of any segment.</div></section>
 <section class="dpanel" data-p="tk"><h2>Ticker</h2><div class="row"><input class="g" id="tk"><button class="p" id="tkb">Broadcast</button></div><h2 style="margin-top:16px">Default live background</h2><div class="row"><label class="b">🖼 Upload default<input type="file" hidden accept="image/*" id="dbg"></label><button id="dbr">Reset to Vienovo winter</button></div><div class="mut">Shown whenever a segment has no picture of its own.</div></section>
 <section class="dpanel" data-p="aw"><h2>📁 Folder</h2><div class="row"><input class="g" id="afn" placeholder="Folder name (e.g. Loyalty 10 years)" maxlength="120" style="flex-basis:100%"></div><div class="row"><input class="g" id="aft" placeholder="🏆 Award shown on screen (e.g. 10 Years of Service)" maxlength="120" style="flex-basis:100%"></div><div class="row"><select class="g" id="afl" aria-label="Location of the folder"></select><button id="afadd">＋ Create folder</button></div><div class="mut">The folder name is for this list only; the Live Screen shows the award. A folder set to one location is only shown to that location's Editor. Drag ⠿ to change the order.</div>
 <h2 style="margin-top:10px">👤 Awardee</h2><div class="row"><input class="g" id="an" placeholder="Employee name" style="flex-basis:100%"></div><div class="row"><select class="g" id="aa" title="Folder the employee goes into"></select><select id="amed" title="Medal for this awardee (optional)">${medalOpts("")}</select><button class="p" id="aadd">Add</button></div>
 <div class="row"><button class="p" id="anx">⏭ Next award</button><button id="aoff">Hide spotlight</button><button class="d" id="aclr">Clear all</button></div><div class="row" id="afvr" hidden><label class="mut g">👁 Show folders for <select id="afv" style="width:100%" title="Only changes what this computer lists; the folders themselves and the other locations are not affected"></select></label></div><div id="al"></div></section>
 <section class="dpanel" data-p="raf"><div class="row"><label class="mut g">📍 Names list for <select id="rloc" style="width:100%"></select></label></div><div class="mut" id="rloch"></div><div class="row"><label class="b p" title="A .txt or .csv file, one participant per line (from Excel: File → Save As → CSV)">📤 Upload final list<input type="file" hidden accept=".txt,.csv,text/plain,text/csv" id="rup"></label><span class="mut g" id="rupm"></span></div><div class="row"><label class="mut g">🎁 Prize for this spin <input id="prize" style="width:100%" placeholder="Type the prize, e.g. Grand Prize: 55-inch 4K Smart TV"></label></div><div class="row"><label class="mut">⏱ Spin time <select id="dur"><option value="0">🎲 Random (10–30 s)</option><option value="10">10 s</option><option value="15">15 s</option><option value="20">20 s</option><option value="25">25 s</option><option value="30">30 s</option><option value="40">40 s</option><option value="60">60 s</option></select></label></div><textarea id="pool" placeholder="Paste participants, one per line (up to 250 per location)"></textarea><div class="mut" id="pmsg" role="status"></div><div class="row"><button id="psave">Remove duplicates</button><button class="p" id="spin">🎡 Spin</button><button id="wshow">👁 Show wheel on Live Screen</button><button id="whide">🙈 Hide wheel</button><button id="ack">✔ Acknowledge &amp; next round</button><span class="mut" id="pc"></span></div><div class="row"><label class="b">🎵 Raffle music<input type="file" hidden accept="audio/*,video/mp4,.mp3,.m4a,.mp4" id="rmu"></label><span class="mut g" id="rmn"></span><button id="rmr">Reset to default</button></div><div id="wl"></div><button class="d" id="wclr">Clear winners</button><div class="row wclrq" id="wclrq" hidden><span class="g mut">Clear the winners. Put their names back in the names list?</span><button class="p" id="wback">↩ Clear &amp; put names back</button><button class="d" id="wonly">🗑 Clear only</button><button id="wno">Cancel</button></div></section>
 <section class="dpanel" data-p="ed"><div id="ed"></div></section>
 <section class="dpanel" data-p="set"><div class="row"><label class="mut">❄ <select id="snow"><option value="off">Snow off</option><option value="light">Light snow</option><option value="lightd">Light snow (no snowflakes)</option><option value="normal">Snowfall</option><option value="normald">Snowfall (no snowflakes)</option><option value="blizzard">Blizzard</option></select></label></div><div class="row"><label class="mut"><input type="checkbox" id="msnd"> 🔊 Sound on this screen too</label></div><div class="row"><label class="mut"><input type="checkbox" id="auto"> ⏰ Follow the schedule (each segment starts by itself at its set time). Leave off while testing.</label></div><div class="row"><button id="msave" title="Copies every video, song and picture of the show to this computer, so they play from its disk instead of over the network. Do it before the show.">⬇ Save media on this PC</button></div><div class="row dir"><button id="dlh" title="Saves your settings plus any pictures, music or videos uploaded in this browser">💾 Download backup</button><label class="b" title="Restore a backup file">📂 Restore backup<input type="file" hidden accept=".json,application/json" id="rbk"></label></div></section>
 </div></aside><div id="dback"></div>
 <div id="segend" class="cue" hidden role="status"><div class="cuetop"><span class="cueic">⏳</span><b class="cuec tm" data-c></b><div class="cuetx"><b data-g></b><span data-n></span></div></div><div class="cuebar"><i></i></div><div class="row"><button id="cue1">+1 min</button><button class="p" id="cuenx">Next segment now ▶</button></div></div>
 <div id="tup" hidden role="alertdialog" aria-labelledby="tuph"><h3 id="tuph">⏰ Time is up</h3><div class="mut" data-tt></div><div class="row"><button class="p" id="tupgo"></button></div><div class="row"><button id="tup1">+1 min</button><button id="tup5">+5 min</button><button id="tupstay">Stay on this segment</button></div></div>`;
  buildStage($(r, "#prev"), 0);
  // the segment list is a left sidebar (collapsible; the choice is remembered on this computer)
  r.classList.add("cshell");
  const sideOff = (on) => {
    document.body.classList.toggle("side-off", on);
    $(r, "#sidec").textContent = on ? "»" : "«";
  };
  sideOff(localStorage.getItem("vtc_side_off") === "1");
  $(r, "#sidec").onclick = () => {
    const on = !document.body.classList.contains("side-off");
    sideOff(on);
    localStorage.setItem("vtc_side_off", on ? "1" : "0");
  };
  const B = (s, f) => ($(r, s).onclick = f);
  // narrow screens: the rundown is an overlay
  B("#sidet", () => document.body.classList.toggle("side-open"));
  $(r, "#center").addEventListener("click", () => document.body.classList.remove("side-open"));
  // right-hand rail: one drawer panel at a time (the editor, opened with the rundown's ✎, uses the same drawer)
  r.querySelectorAll("#rail [data-panel]").forEach(
    (b) => (b.onclick = () => openPanel(curPanel() === b.dataset.panel ? "" : b.dataset.panel)),
  );
  document.addEventListener("vtc-panel", () => syncDrawer(r));
  B("#qanx", nextAward);
  $(r, "#auto").onchange = (e) => {
    S.autoTime = e.target.checked;
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
  $(r, "#dur").onchange = (e) => {
    S.spinSec = +e.target.value;
    save();
  };
  B("#go", togglePlay);
  B("#rst", (e) => {
    if (rst) {
      rst = 0;
      e.target.textContent = "⏮ Restart";
      restartShow();
    } else {
      rst = 1;
      e.target.textContent = "Click again to restart";
      setTimeout(() => {
        rst = 0;
        e.target.textContent = "⏮ Restart";
      }, 3000);
    }
  });
  B("#fxstop", stopSfx);
  $(r, "#fxv").oninput = (e) => {
    S.sfxVol = +e.target.value / 100;
    quiet();
  };
  B("#pop", popOut);
  B("#dclose", () => setDrawer(false));
  B("#dback", () => setDrawer(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerOpen()) setDrawer(false);
  });
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
    const f = $(r, "#aa").value;
    if (!f) return;
    S.awards.push({ name: n, award: f, medal: $(r, "#amed").value });
    // the folder and medal stay picked, for entering several awardees of the same award one after another
    $(r, "#an").value = "";
    $(r, "#an").focus();
    save();
  });
  // folders are named on their own, then employees are added into the picked folder
  B("#afadd", () => {
    if (createFolder($(r, "#afn").value, $(r, "#aft").value, $(r, "#afl").value)) {
      $(r, "#afn").value = "";
      $(r, "#aft").value = "";
      $(r, "#an").focus();
    } else $(r, "#afn").focus();
  });
  $(r, "#afn").onkeydown = $(r, "#aft").onkeydown = (e) => {
    if (e.key === "Enter") $(r, "#afadd").click();
  };
  $(r, "#aa").onchange = (e) => setCurFolder(e.target.value);
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
    if (confirm("Delete all award folders and awardees?")) {
      S.awards = [];
      S.awFolders = [];
      S.awTitle = {};
      S.awLoc = {};
      S.spot = -1;
      S.spotList = null;
      save();
    }
  });
  B("#psave", () => applyPool(r, $(r, "#pool").value));
  B("#spin", () => {
    applyPool(r, $(r, "#pool").value, true);
    spin();
  });
  B("#ack", () => {
    S.raffle = null;
    save();
  });
  B("#wshow", () => {
    S.scene = "spin-wheel";
    S.yt = null;
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
    setPrize(e.target.value);
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
    setPrize(e.target.value);
    quiet();
  };
  // pasting (or leaving the box) cleans the list right away: repeats removed, at most MAXN names
  $(r, "#pool").onpaste = () => setTimeout(() => applyPool(r, $(r, "#pool").value), 0);
  $(r, "#pool").onchange = () => applyPool(r, $(r, "#pool").value);
  $(r, "#pool").oninput = (e) => {
    setPool(e.target.value);
    quiet();
    $(r, "#pc").textContent = poolCount();
    badges(r); // the Raffle count updates as soon as names are pasted
    rafLocUi(r); // and the name count in the location picker
    updateStage($(r, "#prev"), ownOut());
  };
  // Upload the final list of participants into the names list of the location picked above
  $(r, "#rup").onchange = async (e) => {
    const f = e.target.files[0],
      msg = $(r, "#rupm");
    e.target.value = "";
    if (!f) return;
    let names;
    try {
      names = listNames(await f.text(), /\.csv$/i.test(f.name));
    } catch {
      names = [];
    }
    const where = LOCS[rafLoc()];
    if (!names.length) {
      msg.textContent = `⚠ No names found in ${f.name}. Use a .txt or .csv file with one name per line.`;
      return;
    }
    const had = dedupe(poolText()).length,
      n = cleanList(names.join("\n")).names.length;
    if (had && !confirm(`Replace the ${had} names in the ${where} list with the ${n} names from "${f.name}"?`)) return;
    const st = applyPool(r, names.join("\n"));
    msg.textContent = `✔ ${st.names.length} names from ${f.name} are now the ${where} list.`;
  };
  // Clear winners: asks whether the winners' names go back into this location's names list
  const wq = $(r, "#wclrq"),
    wAsk = (on) => {
      wq.hidden = !on;
      $(r, "#wclr").hidden = on;
    };
  const clearWinners = (back) => {
    const mine = locWinners(),
      names = mine.map((w) => w.name);
    S.winners = S.winners.filter((w) => (w.loc || "cebu") !== rafLoc()); // this location's winners only
    S.raffle = null;
    if (back && names.length) {
      const cur = poolText().replace(/\s+$/, "");
      setPool((cur ? cur + "\n" : "") + names.join("\n"));
      setPool(dedupe(poolText()).join("\n")); // a name already in the list is kept once (at most MAXN names)
    }
    wAsk(false);
    save();
  };
  B("#wclr", () => {
    if (!locWinners().length) return;
    wAsk(true);
  });
  B("#wback", () => clearWinners(true));
  B("#wonly", () => clearWinners(false));
  B("#wno", () => wAsk(false));
}
const PLAT = { teams: "Microsoft Teams", meet: "Google Meet", zoom: "Zoom", other: "Meeting" };
/** Live call bar (monitor card): the Director shares the CEO's Teams / Meet / Zoom call to every Live Screen. */
function renderCallBar(r) {
  const bar = $(r, "#callbar"),
    g = S.segs[S.seg] || {},
    c = g.call || {},
    link = meetLink(c.link),
    plat = PLAT[meetPlat(link) || c.platform] || "Meeting",
    open = link ? `<button data-callopen="1" title="${esc(link)}">🔗 Open ${esc(plat)} meeting</button>` : "",
    yid = segYt(g), // this segment is a YouTube Live one: it has its own bar (the meeting options are not mixed in)
    yon = ytOn(),
    backup = segList(g, "vid")[0] ? `<button id="ytvid" title="Stops YouTube Live and plays this segment's first video on the screens">▶ Recorded video instead</button>` : "";
  let H;
  if (S.bc && canControl() && !sharing()) {
    // broadcasting to every site: one status and at most two buttons
    H = `<span class="st on">📡 ALL sites${yon ? " · 📺 YouTube Live" : ""}: ${esc(g.title || S.bc.title || "")}</span><button class="pause" id="bcend">⏹ End broadcast</button>${yon ? backup : ""}`;
  } else if (yid && !sharing() && (yon || S.ytStop === g.id)) {
    // YouTube Live runs in this computer's own flow (the Director's for the Live screens, an Editor's for their own preview / projector).
    // "Stopped / Resume" only shows after it was stopped on purpose.
    H = yon
      ? `<span class="st on">📺 YouTube Live playing ${canControl() ? "on this site's screens" : "here"}</span><button class="pause" id="ytstop">⏹ Stop</button>${backup}`
      : `<span class="g mut">📺 <b>YouTube Live</b> · stopped</span><button class="p" id="ytplay">▶ Resume YouTube Live</button>${backup}`;
  } else if (canControl()) {
    // remote Live screens (not this computer's own pop-out, which gets the picture directly)
    const screens = NET.on ? NET.users.filter((u) => u.role === "screen" && u.name !== NET.you.name + " (screen)").length : 0,
      rx = viewers(),
      recv = screens
        ? ` · ${rx} of ${screens} Live Screen${screens === 1 ? "" : "s"} receiving${rx < screens ? " (the others keep trying)" : ""}`
        : "";
    H = sharing()
      ? `<span class="st on">📡 CALL ON AIR${recv}${S.call && !S.call.audio ? " · ⚠ no sound shared" : ""}</span>${open}<button class="pause" id="callstop">⏹ Stop sharing the call</button>`
      : !link && !c.link
        ? "" // nothing to share: no bar
        : `<span class="g mut">📞 <b>Live call</b> ${link ? "· " + esc(plat) + " link set for this segment" : c.link ? "· ⚠ the meeting link in this segment is not valid (fix it in the Segment editor)" : "· no meeting link in this segment (add it in the Segment editor)"}</span>${open}${
          canShare()
            ? `<button class="p" id="callgo" title="Pick the browser tab with the meeting. Tick 'Also share tab audio'.">📡 Share call to Live Screens</button>`
            : `<button class="warnb" id="callgo" title="This address can't share a tab">⚠ Sharing blocked on this address: how to fix</button>`
        }`;
  } else {
    // an Editor: only the Director sets and plays the meeting link
    H = callLive()
      ? `<span class="st on">📡 The CEO call is on air (shared by ${esc(S.call.by || "the Director")}). Watch it with “Pop-out Live Screen”.</span>`
      : link
        ? `<span class="g mut">📞 This segment has a ${esc(plat)} call. Only the Director plays it on the Live Screens.</span>`
        : "";
  }
  // an Editor sees that Cebu's program is on their output
  if (S.bc && !canControl())
    H = `<span class="st on">📡 Cebu Director is playing ${esc(S.bc.title || "the program")} on all sites. Your own show carries on underneath and returns when it ends.</span>` + H;
  if (bar._h !== H) {
    bar._h = H;
    bar.innerHTML = H;
  }
  bar.style.display = H ? "" : "none";
  const be = bar.querySelector("#bcend");
  if (be) be.onclick = endBc;
  const o = bar.querySelector("[data-callopen]");
  if (o) o.onclick = () => window.open(link, "_blank", "noopener");
  const go = bar.querySelector("#callgo");
  if (go) go.onclick = startCall;
  const yp = bar.querySelector("#ytplay");
  if (yp) yp.onclick = playYt;
  const ys = bar.querySelector("#ytstop");
  if (ys) ys.onclick = stopYt;
  const yv = bar.querySelector("#ytvid");
  if (yv)
    yv.onclick = () => {
      S.yt = null;
      S.ytStop = g.id;
      cmd("vid", "play", [segList(g, "vid")[0]]);
    };
  const st = bar.querySelector("#callstop");
  if (st) st.onclick = stopCall;
}
const PANELS = { lib: "Media library", sfx: "Sound effects", tk: "Ticker & background", aw: "Employee awards", raf: "Grand raffle", set: "Settings" };
/** drawer title + highlighted rail button for the open panel */
function syncDrawer(r) {
  const p = curPanel();
  let t = PANELS[p] || "";
  if (p === "ed") t = "Segment: " + ((S.segs[S.edit] || {}).title || "");
  setTx($(r, "#dtitle"), t);
  r.querySelectorAll("#rail [data-panel]").forEach((b) => {
    b.classList.toggle("on", b.dataset.panel === p);
    b.setAttribute("aria-pressed", b.dataset.panel === p ? "true" : "false");
  });
}
function renderControl(r) {
  document.body.classList.toggle("role-editor", !canControl());
  renderNet($(r, "#net"));
  renderCallBar(r);
  syncDrawer(r);
  {
    const p = $(r, "#pop");
    setTx(p, canControl() ? "Pop-out Live Screen ↗" : "Pop-out my screen ↗");
    p.title = canControl() ? "Opens the Live Screen for all Cebu screens" : "Opens this site's projector screen";
    const g = S.segs[S.seg] || {},
      wheel = S.scene === "spin-wheel" || /raffle/i.test(g.title || ""),
      fold = !!segFolder(),
      aw = !fold && (S.spot >= 0 || /award/i.test(g.title || "")),
      q = $(r, "#quick");
    $(r, "#qwheel").hidden = !wheel;
    $(r, "#qaw").hidden = !aw;
    renderSegFolder(r);
    q.hidden = !(wheel || aw || fold);
    badges(r);
  }
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
    st.title = st.textContent;
  }
  $(r, "#auto").checked = !!S.autoTime;
  $(r, "#msnd").checked = !!S.monSound;
  {
    const q = $(r, "#qprize");
    if (q && document.activeElement !== q) q.value = prizeText();
  }
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
        S.yt = null; // any other scene button takes YouTube Live off the screens
        save();
      }),
  );
  renderRundown(r);
  renderLibrary(r);
  renderSfx(r);
  if (document.activeElement !== $(r, "#fxv")) $(r, "#fxv").value = String(Math.round((S.sfxVol ?? 1) * 100));
  {
    const a = document.activeElement;
    if (!r.contains(a) || !(a.dataset.f || a.dataset.cf || a.dataset.yt)) renderEditor(r);
  }
  if (document.activeElement !== $(r, "#tk")) $(r, "#tk").value = S.ticker;
  renderAwards(r);
  rafLocUi(r);
  if (document.activeElement !== $(r, "#pool")) $(r, "#pool").value = poolText();
  if (document.activeElement !== $(r, "#prize")) $(r, "#prize").value = prizeText();
  $(r, "#pc").textContent = poolCount();
  $(r, "#wl").innerHTML =
    locWinners()
      .map(
        (w, i) =>
          `<div>${i + 1}. 🏆 ${esc(w.name)}${w.prize ? ` <span class="mut">· ${esc(w.prize)}</span>` : ""}</div>`,
      )
      .join("") || `<div class="mut">No winners yet at ${esc(LOCS[rafLoc()])}.</div>`;
}

/** the counts on the tool rail (Media, Awards, Raffle); also called while typing / pasting, which saves without a full redraw */
function badges(r) {
  const bd = (id, n) => {
    const e = $(r, id);
    if (!e) return;
    setTx(e, n ? String(n) : "");
    e.hidden = !n;
  };
  bd("#bg-lib", S.lib.filter((m) => m.kind !== "sfx").length);
  bd("#bg-aw", S.awards.length);
  bd("#bg-raf", dedupe(poolText()).length);
}

/** "168 / 250 in pool" for this location */
const poolCount = () => `${dedupe(poolText()).length} / ${MAXN} in pool`;
/**
 * Make `text` this location's raffle list, cleaned (repeats and winners removed, at most MAXN names),
 * update the box and counts, and say what was removed. quietOk = no message when nothing was removed.
 */
function applyPool(r, text, quietOk) {
  const st = cleanList(text),
    box = $(r, "#pool"),
    msg = $(r, "#pmsg"),
    where = LOCS[rafLoc()] || "this location";
  setPool(st.names.join("\n"));
  save();
  box.value = poolText();
  $(r, "#pc").textContent = poolCount();
  const L = [];
  if (st.dup) L.push(`${st.dup} duplicate${st.dup > 1 ? "s" : ""} removed`);
  if (st.won) L.push(`${st.won} already won at ${where} (left out)`);
  if (st.over) L.push(`⚠ ${st.over} name${st.over > 1 ? "s" : ""} not added: the limit is ${MAXN} per location`);
  if (L.length || !quietOk) msg.textContent = `✔ ${st.names.length} participant${st.names.length === 1 ? "" : "s"} for ${where}` + (L.length ? " · " + L.join(" · ") : "");
  msg.classList.toggle("warn", !!st.over);
  badges(r);
  rafLocUi(r);
  updateStage($(r, "#prev"), ownOut());
  return st;
}
/** names from an uploaded list: one per line; for a .csv the first column (quotes handled), skipping a "Name" header */
function listNames(text, csv) {
  const cell = (line) => {
    if (!csv) return line;
    const m = line.match(/^\s*"((?:[^"]|"")*)"/);
    return m ? m[1].replace(/""/g, '"') : line.split(/[,;\t]/)[0];
  };
  const out = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => cell(l).trim())
    .filter(Boolean);
  if (out.length && /^(full\s*)?names?$|^participants?$|^employees?$/i.test(out[0])) out.shift();
  return out;
}

/** Grand raffle location: the Director picks which location's names list to paste and spin;
 * an Editor always works on their own location's list. Older single lists move to this location once. */
function rafLocUi(r) {
  const ed = !canControl() && !!myLoc();
  if (ed && S.rafLoc !== myLoc()) S.rafLoc = myLoc(); // kept on this computer only (part of an Editor's own flow)
  if (!ed && !S.rafLoc && LOCS[myLoc()]) S.rafLoc = myLoc();
  if (canControl() && (S.pool || S.prize) && !Object.keys(S.pools || {}).length) {
    setPool(S.pool || "");
    setPrize(S.prize || "");
    S.pool = "";
    S.prize = "";
    save();
  }
  const sel = $(r, "#rloc"),
    H = Object.entries(LOCS)
      .map(([k, nm]) => `<option value="${k}" ${k === rafLoc() ? "selected" : ""}>📍 ${esc(nm)} (${dedupe(k === rafLoc() ? poolText() : (S.pools || {})[k] || "").length} names)</option>`)
      .join("");
  if (sel._h !== H + ed) {
    sel._h = H + ed;
    sel.innerHTML = H;
    sel.disabled = ed;
    $(r, "#rloch").textContent = ed
      ? "You upload or paste, and spin, the names for your own location."
      : "Pick a location, then upload or paste its final list. Each location keeps its own names, prize and winners.";
  }
  sel.onchange = () => {
    S.rafLoc = sel.value;
    S.raffle = null;
    $(r, "#pmsg").textContent = "";
    $(r, "#rupm").textContent = "";
    save();
  };
}

export { setTx, updNext, dupTab, buildControl, renderControl };
