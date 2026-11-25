/** Render loop and the 1-second scheduler (auto-pilot runs only while the show is running). */
import { $ } from "./constants.js";
import { S } from "./state.js";
import { LIVE, master, ownOut } from "./sync.js";
import { vidPlaying } from "./playback.js";
import { buildStage, tick, updateStage } from "./stage/stage.js";
import { setSeg } from "./actions.js";
import { now } from "./clock.js";
import { updNext, buildControl, renderControl } from "./control/control.js";

let lm = true,
  lastKey = "";
setInterval(() => {
  const d = new Date(),
    p = (n) => String(n).padStart(2, "0"),
    hm = p(d.getHours()) + ":" + p(d.getMinutes()),
    ck = hm + ":" + p(d.getSeconds());
  raf(() => {
    document.querySelectorAll(".stage").forEach(tick);
    const c = document.getElementById("clk");
    if (c && c._t !== ck) {
      c._t = ck;
      c.textContent = ck;
    }
  });
  if (!LIVE) {
    const m = master();
    if (m !== lm) {
      lm = m;
      render();
    }
    raf(updNext);
  }
  // nothing starts or advances by itself until Start / Resume is pressed (an Editor's flow runs on their computer only)
  if (LIVE || !S.running) return;
  // ⏰ Follow the schedule (off unless turned on in Settings): a segment with a set clock time starts at that time
  if (S.autoTime) {
    const key = d.toDateString() + hm,
      i = S.segs.findIndex((g) => g.time === hm);
    if (i >= 0 && lastKey !== key) {
      lastKey = key;
      if (i !== S.seg) setSeg(i);
      return;
    }
  }
  // time is up: the segment's own setting decides (go on by itself, or ask with a pop-up - see control.js)
  const g = S.segs[S.seg],
    nx = S.segs[S.seg + 1];
  if (g.endAct === "next" && nx && now() - S.segStart >= g.min * 60000 + 5000 && !vidPlaying() && S.hold !== S.segStart)
    setSeg(S.seg + 1);
}, 1000);
function raf(f) {
  if (document.hidden) f();
  else requestAnimationFrame(f);
}
let rq = 0;
function render() {
  if (document.hidden) {
    doRender();
    return;
  }
  if (rq) return;
  rq = 1;
  requestAnimationFrame(() => {
    rq = 0;
    doRender();
  });
}
function doRender() {
  const r = document.getElementById("app");
  if (LIVE) {
    if (!r._b) {
      document.body.classList.add("live");
      buildStage(r, 1);
      r._b = 1;
    }
    updateStage(r, 1);
    return;
  }
  if (!r._b) {
    buildControl(r);
    r._b = 1;
  }
  renderControl(r);
  // the Director's monitor hands the program over to the pop-out; an Editor's monitor plays their own flow
  updateStage($(r, "#prev"), ownOut());
}
export { raf, render, doRender };
