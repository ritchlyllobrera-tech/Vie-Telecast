/** The 16:9 broadcast stage (used by both the monitor and the live screen): background, snow, panels, ticker, awards. */
import { LOGO, BG0, MEDAL, PER, $, esc, fmt, meetLink } from "../constants.js";
import { S, awTitle, dedupe, segLeft, ytOn } from "../state.js";
import { act, LIVE, MINE } from "../sync.js";
import { url } from "../media.js";
import { doCmd } from "../playback.js";
import { drawWheel, reveal, confetti } from "./wheel.js";
import { callLive, callStream, callWait } from "../call.js";
import { canControl } from "../net.js";
import { now } from "../clock.js";

/* stage */
const FE = (() => {
  let d = "M0 0L185 185";
  for (let i = 1; i <= 8; i++) {
    const t = i * 0.11,
      bx = 180 * t,
      by = 180 * t,
      L = 62 * (1 - t) + 16;
    for (const sg of [-1, 1]) {
      const a = Math.PI / 4 + sg * 0.95,
        ex = bx + Math.cos(a) * L,
        ey = by + Math.sin(a) * L;
      d += "M" + bx.toFixed(1) + " " + by.toFixed(1) + "L" + ex.toFixed(1) + " " + ey.toFixed(1);
      const mx = bx + Math.cos(a) * L * 0.55,
        my = by + Math.sin(a) * L * 0.55;
      for (const s2 of [-1, 1]) {
        const b = a + s2 * 0.8,
          l2 = L * 0.38;
        d +=
          "M" +
          mx.toFixed(1) +
          " " +
          my.toFixed(1) +
          "L" +
          (mx + Math.cos(b) * l2).toFixed(1) +
          " " +
          (my + Math.sin(b) * l2).toFixed(1);
      }
    }
  }
  const v = '<svg class="fe" viewBox="0 0 200 200" aria-hidden="true"><path d="' + d + '" pathLength="100"/></svg>';
  return (
    v +
    v.replace('class="fe"', 'class="fe f2"') +
    v.replace('class="fe"', 'class="fe f3"') +
    v.replace('class="fe"', 'class="fe f4"')
  );
})();
function buildStage(el, live) {
  el.classList.add("stage");
  el.innerHTML =
    '<img class="bg" alt=""><div class="shade"></div><canvas class="snow"></canvas><video playsinline preload="auto"></video><video class="call" playsinline autoplay muted></video><div class="callmsg"><b>📡 LIVE CALL</b><span>Connecting to the live call…</span></div><div class="panel"></div><div class="wheelbox"><div class="wr"><canvas width="700" height="700"></canvas><div class="lts"></div><div class="ptr"></div></div><div class="win"></div><button class="xb" data-a="closeWheel">✕ Close</button></div><canvas class="cf"></canvas><div class="wn"><div class="wc ice"><i class="fr"></i><i class="ic"></i>' +
    FE +
    '<i class="fg"></i><i class="sp" style="left:5%;top:26%">✦</i><i class="sp" style="right:6%;top:40%;animation-delay:.8s">✧</i><i class="sp" style="left:9%;bottom:12%;animation-delay:1.3s">✧</i><button class="xb" data-a="closeWinner">✕ Close</button><div class="rd"></div><div class="cg">CONGRATULATIONS!</div><div class="ow"><small>OFFICIAL WINNER</small><div class="nm"></div></div><div class="pz"></div></div></div><div class="onair">● ON AIR</div><div class="ctr"><span><small>LEFT</small><b class="l"></b></span><span><i></i><small>UP</small><b class="u"></b></span></div><div class="lt"></div><div class="aw"></div><div class="tk"><b>PROGRAM INFO</b><div class="mqw"><span></span></div></div><div class="gate">🔊 Click once to enable sound</div>';
  const cv = $(el, ".snow"),
    MX = 300,
    fl = Array.from({ length: MX }, (_, i) => {
      const R = (n) => {
        const q = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
        return q - Math.floor(q);
      };
      return { x: R(1), o: R(2), z: R(3), s: R(4) * 6, k: R(5) };
    }),
    MODE = {
      light: [40, 0.7, 0.03, 1],
      lightd: [40, 0.7, 0.03, 0],
      normal: [110, 1, 0.06, 1],
      normald: [110, 1, 0.06, 0],
      blizzard: [300, 2.4, 0.25, 1],
    };
  (function sn(t) {
    requestAnimationFrame(sn);
    if (document.hidden || el._vid || t - (cv._t || 0) < 33) return;
    cv._t = t;
    const W = cv.clientWidth || 640,
      H = cv.clientHeight || 360;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const c = cv.getContext("2d"),
      n = Date.now(),
      m = MODE[S.snow || "normal"];
    c.clearRect(0, 0, W, H);
    if (!m) return;
    const K = W / 900,
      N = Math.min(m[0], MX),
      Gv = Math.sin(n / 5200) * 0.6 + Math.sin(n / 2300 + 1.3) * 0.3 + Math.sin(n / 9100 + 0.4) * 0.5;
    c.lineCap = "round";
    for (let i = 0; i < N; i++) {
      const f = fl[i],
        z = f.z,
        v = (0.00004 + z * 0.00014) * m[1],
        y = (f.o + n * v + Math.sin(n / 800 + f.s) * 0.004) % 1,
        x =
          (((f.x +
            Gv * m[2] * (0.4 + z) +
            Math.sin(n / (900 + f.k * 1300) + f.s) * (0.012 + m[2] * 0.08) +
            Math.sin(n / (2300 + f.k * 2000) + f.s * 1.7) * 0.008) %
            1) +
            1) %
          1,
        px = x * W,
        py = y * H,
        r = (1 + z * 3.2) * K,
        al = 0.4 + z * 0.55;
      if (z > 0.82 && m[1] < 2 && m[3]) {
        c.save();
        c.translate(px, py);
        c.rotate(n / (2500 + f.k * 3000) + f.s);
        c.strokeStyle = "rgba(150,195,240," + al + ")";
        c.lineWidth = Math.max(1, r * 0.38);
        const L = r * 2.6;
        c.beginPath();
        for (let q = 0; q < 6; q++) {
          const a = (q * Math.PI) / 3,
            cx = Math.cos(a),
            cy = Math.sin(a);
          c.moveTo(0, 0);
          c.lineTo(cx * L, cy * L);
          c.moveTo(cx * L * 0.6, cy * L * 0.6);
          c.lineTo(Math.cos(a + 0.6) * L * 0.9, Math.sin(a + 0.6) * L * 0.9);
          c.moveTo(cx * L * 0.6, cy * L * 0.6);
          c.lineTo(Math.cos(a - 0.6) * L * 0.9, Math.sin(a - 0.6) * L * 0.9);
        }
        c.stroke();
        c.restore();
      } else {
        c.fillStyle = "rgba(255,255,255," + al + ")";
        c.beginPath();
        c.arc(px, py, r, 0, 7);
        c.fill();
        c.strokeStyle = "rgba(140,185,235," + al * 0.8 + ")";
        c.lineWidth = 1;
        c.stroke();
      }
    }
    if (m[1] >= 2) {
      c.fillStyle = "rgba(255,255,255,.1)";
      c.fillRect(0, 0, W, H);
    }
  })(0);
  const gate = $(el, ".gate");
  if (live) gate.style.display = "flex";
  if (live) {
    const b = document.createElement("button");
    b.className = "fsb";
    b.textContent = "⛶ Fullscreen";
    const fs = () => {
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen().catch(() => {});
    };
    b.onclick = (e) => {
      e.stopPropagation();
      fs();
    };
    el.appendChild(b);
    el.ondblclick = fs;
    document.addEventListener("fullscreenchange", () => {
      b.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
    });
    document.addEventListener("keydown", (e) => {
      if ((e.key === "f" || e.key === "F") && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || "")) fs();
    });
  }
  const unlock = () => {
    gate.style.display = "none";
    const cv = $(el, "video.call");
    if (live && cv.srcObject) {
      cv.muted = false;
      cv.play().catch(() => {});
    }
    if (el._yf && live) ytSound(el);
    if (!el._unl) {
      el._unl = 1;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) new AC().resume();
      } catch (e) {}
    }
    if (el._gate) {
      el._gate = 0;
      const v = $(el, "video");
      if (v.getAttribute("src") && !v.paused && S.cmd && S.cmd.kind === "vid") {
        v.muted = false;
      } else if (S.cmd && S.cmd.kind === "aud" && el._a && el._a.getAttribute("src") && el._wd && el._wd.alive()) {
        el._a.play().catch(() => {}); // carry on with the current song instead of restarting the playlist
      } else {
        el._ts = null;
        doCmd(el);
      }
    }
  };
  gate.onclick = unlock;
  ["pointerdown", "keydown", "touchstart"].forEach((t) => window.addEventListener(t, unlock, { capture: true }));
  $(el, ".ctr").onclick = () => {
    el._mode = 1 - (el._mode || 0);
    tick(el);
  };
  {
    const lts = $(el, ".lts"),
      cs = ["#ef4444", "#22c55e", "#fbbf24", "#38bdf8", "#ffffff"];
    let h = "";
    for (let i = 0; i < 36; i++) h += '<i style="--a:' + i * 10 + "deg;--c:" + cs[i % 5] + '"></i>';
    lts.innerHTML = h;
    lts.style.setProperty("--o", -(Date.now() % 1200) / 1000 + "s");
  }
  el._ang = 0;
  el._sid = null;
  el.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-a]");
    if (b) {
      e.stopPropagation();
      act(b.dataset.a);
    }
  });
  $(el, ".tk .mqw span").style.animationDelay = -(Date.now() % 50000) / 1000 + "s";
}
function tick(el) {
  const g = S.segs[S.seg] || S.segs[0],
    left = segLeft(),
    l = $(el, ".ctr .l"),
    u = $(el, ".ctr .u"),
    m = $(el, ".tk .mqw span");
  const f2 = (ms) => {
    const s = Math.floor(Math.abs(ms) / 1000),
      h = Math.floor(s / 3600);
    return (
      (h ? String(h).padStart(2, "0") + ":" : "") +
      String(Math.floor((s % 3600) / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0")
    );
  };
  const nxt = S.running && S.auto && S.segs[S.seg + 1] && left < 0,
    lt = nxt ? "NEXT IN " + Math.max(0, Math.ceil((5000 + left) / 1000)) + "s" : (left < 0 ? "OVER " : "") + f2(left),
    ut = S.started ? fmt(now() - S.t0) : "00:00:00",
    col = left < 0 ? "#f87171" : "";
  const T = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  let rng = g.min + " min";
  if (g.time) {
    const [h, mm] = g.time.split(":"),
      st = new Date();
    st.setHours(+h, +mm, 0, 0);
    rng = T(st) + " - " + T(+st + g.min * 60000);
  } else if (S.running) rng = T(S.segStart) + " - " + T(S.segStart + g.min * 60000);
  const mt =
    S.ticker +
    "   \u2022   PST Time: " +
    new Date().toLocaleTimeString("en-US", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "   \u2022   Current Segment: " +
    g.title +
    " (" +
    rng +
    ")";
  if (l._t !== lt) {
    l._t = lt;
    l.textContent = lt;
  }
  if (l._c !== col) {
    l._c = col;
    l.style.color = col;
  }
  if (u._t !== ut) {
    u._t = ut;
    u.textContent = ut;
  }
  if (m._t !== mt) {
    m._t = mt;
    m.textContent = mt;
  }
}
/* sound effects: one-shot sounds layered over the music; plays where the program sound plays */
function playSfxOn(el, own) {
  const fx = S.sfx;
  if (!fx || el._fx === fx.ts) return;
  el._fx = fx.ts;
  el._fxa = el._fxa || [];
  if (!fx.id) {
    el._fxa.forEach((a) => a.pause());
    el._fxa = [];
    return;
  }
  if (Date.now() - fx.ts > 4000 || !(own || S.monSound)) return; // stale, or this screen is muted
  url(fx.id).then((u) => {
    if (!u) return;
    const a = new Audio(u);
    a.volume = S.sfxVol ?? 1;
    a.onended = () => (el._fxa = el._fxa.filter((x) => x !== a));
    el._fxa.push(a);
    a.play().catch(() => {});
  });
}
/**
 * YouTube Live on the stage: one <iframe>, created once per video id and reused (re-creating it reloads the stream).
 * It always starts muted (muted autoplay is always allowed, so the picture never stalls on a blocked autoplay);
 * sound is switched on with the player's postMessage API (unMute / playVideo) from a user click, without a reload.
 * pointer-events:none keeps double-click fullscreen and the gate working over the player.
 */
const YT = "https://www.youtube-nocookie.com";
function ytCmd(f, fn, args) {
  try {
    f.contentWindow.postMessage(JSON.stringify({ event: "command", func: fn, args: args || [] }), YT);
  } catch {
    /* frame gone */
  }
}
function ytSound(el) {
  const f = el._yf;
  if (!f) return;
  el._ys = 1;
  if (el._ysb) {
    el._ysb.remove();
    el._ysb = null;
  }
  // the player may still be starting: repeat for a few seconds (harmless once it has obeyed)
  for (const t of [0, 400, 1200, 3000])
    setTimeout(() => {
      if (el._yf !== f) return;
      ytCmd(f, "unMute");
      ytCmd(f, "setVolume", [100]);
      ytCmd(f, "playVideo");
    }, t);
}
function ytFrame(el, id, live) {
  if (!id) {
    if (el._yf) el._yf.remove();
    if (el._ysb) el._ysb.remove();
    el._yf = el._ysb = null;
    el._yid = "";
    return;
  }
  if (!el._yf || el._yid !== id) {
    if (el._yf) el._yf.remove();
    const f = document.createElement("iframe");
    el._yid = id;
    el._ys = 0;
    f.className = "ytf";
    f.src = `${YT}/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1${live ? "&enablejsapi=1&origin=" + encodeURIComponent(location.origin) : ""}`;
    f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.allowFullscreen = true;
    f.setAttribute("frameborder", "0");
    f.title = "YouTube Live";
    if (live) f.onload = () => el._unl && ytSound(el); // the screen was already clicked: sound straight away
    el.appendChild(f);
    el._yf = f;
  }
  const want = live && !el._ys;
  if (want && !el._ysb) {
    const b = document.createElement("button");
    b.className = "ytsnd";
    b.textContent = "🔊 Click to enable sound";
    b.onclick = (e) => {
      e.stopPropagation();
      ytSound(el);
    };
    el.appendChild(b);
    el._ysb = b;
  } else if (!want && el._ysb) {
    el._ysb.remove();
    el._ysb = null;
  }
}
/**
 * "All sites" broadcast on an Editor's output (their preview and their "MY screen" window): the Director's program is shown by
 * embedding a real Live screen (#live) over the stage, so it renders exactly like Cebu's. The Editor's own music / video is paused
 * meanwhile and carries on when the broadcast ends.
 */
function bcFrame(el, on) {
  if (!on) {
    if (!el._bf) return;
    el._bf.remove();
    el._bf = null;
    const p = el._bcp;
    el._bcp = null;
    if (p && p.a && el._a) el._a.play().catch(() => {});
    if (p && p.v) $(el, "video").play().catch(() => {});
    return;
  }
  if (el._bf) return;
  const v = $(el, "video"),
    f = document.createElement("iframe");
  el._bcp = { a: !!(el._a && !el._a.paused), v: !v.paused };
  if (el._a) el._a.pause();
  v.pause();
  f.className = "bcf";
  f.src = location.href.split("#")[0] + "#live";
  f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
  f.title = "Cebu Director's program";
  el.appendChild(f);
  el._bf = f;
}
function updateStage(el, own) {
  const showB = !!S.bc && (MINE || (!LIVE && !canControl()));
  bcFrame(el, showB);
  if (showB) return;
  const g = S.segs[S.seg] || S.segs[0],
    sc = S.scene,
    P = $(el, ".panel"),
    wb = $(el, ".wheelbox"),
    v = $(el, "video"),
    isW = sc === "spin-wheel",
    vs = /video/.test(sc),
    pv = S.cmd && S.cmd.kind === "vid" && S.cmd.action !== "stop";
  const bid = S.bgId || S.defBg || "";
  if (el._bg !== bid) {
    el._bg = bid;
    const im = $(el, ".bg");
    im.classList.toggle("kb", !!bid);
    im.style.animationDelay = -(Date.now() % 44000) / 1000 + "s";
    if (!bid) {
      im.src = BG0;
      im.style.opacity = 1;
    } else
      url(bid).then((u) => {
        if (el._bg === bid) {
          im.style.opacity = 0;
          setTimeout(() => {
            im.src = u || BG0;
            im.style.opacity = 1;
          }, 400);
        }
      });
  }
  if (el._sc !== sc) {
    el._sc = sc;
    for (const n of [P, wb]) {
      n.classList.remove("pop");
      void n.offsetWidth;
      n.classList.add("pop");
    }
  }
  // the call belongs to the program: Live screens and the Director's monitor, not an Editor's own preview
  const showY = ytOn(), // also in an Editor's own preview: their flow is local, see PLAY in net.js
    showC = callLive() && !showY && !MINE && (LIVE || canControl()),
    cv = $(el, "video.call"),
    cs = showC ? callStream() : null;
  if (cv.srcObject !== cs) {
    cv.srcObject = cs;
    if (cs) cv.play().catch(() => {});
  }
  // no sound until someone clicked this screen once (browser rule), and only where the program sound plays
  cv.muted = !el._unl || (!own && !S.monSound);
  cv.style.display = showC ? "block" : "none";
  {
    const cm = $(el, ".callmsg");
    cm.style.display = showC && !cs ? "flex" : "none";
    if (showC && !cs) {
      // still no picture after a while: this location can join the meeting itself instead
      const late = LIVE && callWait() > 15000,
        link = late ? meetLink((g.call || {}).link) : "",
        h =
          "<b>📡 LIVE CALL</b>" +
          (late
            ? "<span>Still connecting to the Director's computer…</span>" +
              (link
                ? '<button class="meetb" data-meet="' + esc(link) + '">🔗 Join the meeting on this screen instead</button>'
                : "")
            : "<span>Connecting to the live call…</span>");
      if (cm._h !== h) {
        cm._h = h;
        cm.innerHTML = h;
        const b = cm.querySelector("[data-meet]");
        if (b)
          b.onclick = (e) => {
            e.stopPropagation();
            window.open(b.dataset.meet, "_blank", "noopener");
          };
      }
    }
  }
  ytFrame(el, showY ? S.yt.id : "", !!LIVE || (own && !canControl()));
  const showV = !showC && !showY && vs && pv && (own || S.monVid !== false);
  v.muted = el._gate ? true : !own && !S.monSound;
  el._vid = showV || showC || showY;
  $(el, ".snow").style.visibility = el._vid ? "hidden" : "visible";
  $(el, ".bg").classList.toggle("paused", el._vid);
  v.style.display = showV ? "block" : "none";
  if (!showV && !v.paused) v.pause();
  P.style.display = isW || el._vid ? "none" : "flex";
  wb.style.display = isW ? "flex" : "none";
  const T = {
      "live-feed": ["LIVE TELECAST", "Cebu City · NCR Makati · CDO Mindanao"],
      "ceo-video": ["CEO MESSAGE", g.title],
      "opening-video": ["OPENING VIDEO", g.title],
      "segment-video": ["SEGMENT VIDEO", g.title],
    },
    c = T[sc];
  if (!isW) {
    const html = c
      ? '<div class="gc"><div class="k">' +
        esc(c[0]) +
        '</div><div class="big">' +
        esc(c[1]) +
        "</div>" +
        (g.desc ? '<div class="sub">' + esc(g.desc) + "</div>" : "") +
        (vs && pv && !own ? '<div class="sub">▶ Playing on the live screen</div>' : "") +
        (vs && !pv ? '<div class="sub">No video playing — press ▶ in the segment editor</div>' : "") +
        "</div>"
      : S.bgId
        ? ""
        : '<img class="logo" src="' +
          LOGO +
          '" alt="Vienovo"><div class="pill">❄ FEED FOR LIFE • TOGETHER IN CELEBRATION ❄</div><div class="ttl">YEAR END &amp;<br>CHRISTMAS<br>PARTY<em>2026</em></div>';
    if (el._h !== html) {
      el._h = html;
      P.innerHTML = html;
      const lg = P.querySelector(".logo");
      if (lg) lg.style.animationDelay = -(Date.now() % 4000) / 1000 + "s";
    }
  }
  const a = S.awards[S.spot],
    aw = $(el, ".aw");
  if (a) {
    aw.style.display = "flex";
    const md = MEDAL[a.medal] ? a.medal : "",
      key = S.spot + "|" + a.name + "|" + awTitle(a.award || "Award") + "|" + md + "|" + S.awards.length;
    if (el._ak !== key) {
      el._ak = key;
      const fs = Math.max(3.2, Math.min(6, 80 / Math.max(a.name.length, 1)));
      let k = 0;
      aw.innerHTML =
        '<div class="ac ice' +
        (md ? " m-" + md : "") +
        '"><i class="fr"></i><i class="ic"></i>' +
        FE +
        '<i class="fg"></i><button class="xb" data-a="closeAward">\u2715 Close</button>' +
        (md ? '<div class="medal"><span>' + MEDAL[md][0] + "</span>" + MEDAL[md][1] + "</div>" : "") +
        '<div class="at">' +
        esc(awTitle(a.award || "Award")) +
        '</div><div class="an" style="font-size:' +
        fs +
        'cqw">' +
        a.name
          .split(" ")
          .map(
            (w) =>
              '<b class="w">' +
              [...w]
                .map((ch) => '<span style="animation-delay:' + (0.45 + k++ * 0.05) + 's">' + esc(ch) + "</span>")
                .join("") +
              "</b>",
          )
          .join(" ") +
        '</div><i class="sp" style="left:6%;top:14%">\u2726</i><i class="sp" style="right:7%;top:20%;animation-delay:.7s">\u2727</i><i class="sp" style="left:12%;bottom:16%;animation-delay:1.1s">\u2727</i><i class="sp" style="right:10%;bottom:12%;animation-delay:.3s">\u2726</i></div>';
      aw.firstChild.style.setProperty("--d", -(Date.now() % 4000) / 1000 + "s");
      if (now() - (S.spotTs || 0) < 2000) confetti(el, S.spotTs);
    }
  } else if (S.spotList && S.awards.some((x) => (x.award || "Award") === S.spotList.award)) {
    // an award's awardees, PER names per page
    const L = S.spotList,
      all = S.awards.filter((x) => (x.award || "Award") === L.award),
      pages = Math.ceil(all.length / PER),
      pg = Math.max(0, Math.min(L.page || 0, pages - 1)),
      names = all.slice(pg * PER, pg * PER + PER),
      key = "L|" + awTitle(L.award) + "|" + pg + "|" + names.map((x) => x.name + ":" + (x.medal || "")).join(",");
    aw.style.display = "flex";
    if (el._ak !== key) {
      el._ak = key;
      const long = Math.max(...names.map((x) => x.name.length), 1),
        rows = Math.ceil(names.length / 2), // two columns, filled top to bottom
        fs = rows > 4 ? Math.max(1.2, Math.min(1.9, 36 / long)) : Math.max(1.5, Math.min(2.6, 46 / long));
      aw.innerHTML =
        '<div class="ac ice al"><i class="fr"></i><i class="ic"></i>' +
        FE +
        '<i class="fg"></i><button class="xb" data-a="closeAward">✕ Close</button>' +
        '<div class="at">' +
        esc(awTitle(L.award)) +
        '</div><ol class="anl" start="' +
        (pg * PER + 1) +
        '" style="font-size:' +
        fs +
        "cqw;grid-template-rows:repeat(" +
        rows +
        ',auto)">' +
        names
          .map(
            (x, n) =>
              '<li style="animation-delay:' +
              (0.35 + n * (names.length > 8 ? 0.06 : 0.12)) +
              's"><span>' +
              (MEDAL[x.medal] ? MEDAL[x.medal][0] + " " : "") +
              esc(x.name) +
              "</span></li>",
          )
          .join("") +
        "</ol>" +
        (pages > 1 ? '<div class="apg">' + (pg + 1) + " / " + pages + "</div>" : "") +
        '<i class="sp" style="left:6%;top:14%">✦</i><i class="sp" style="right:7%;top:20%;animation-delay:.7s">✧</i></div>';
      aw.firstChild.style.setProperty("--d", -(Date.now() % 4000) / 1000 + "s");
      if (now() - (L.ts || 0) < 2000) confetti(el, L.ts);
    }
  } else {
    aw.style.display = "none";
    el._ak = "";
  }
  el._sp = S.spot;
  $(el, ".tk span").textContent = S.ticker;
  tick(el);
  doCmd(el, !own);
  if (el._a) el._a.muted = !own && !S.monSound;
  if (el._a && !own) el._a.onended = null;
  playSfxOn(el, own);
  $(el, ".wn").style.display = isW && S.raffle && el._rev === S.raffle.spinId ? "flex" : "none";
  const wc = $(el, ".wr canvas"),
    win = $(el, ".win");
  $(el, ".wr").classList.toggle("all", !!(isW && S.raffle && el._rev === S.raffle.spinId));
  if (isW && !S.raffle) {
    const pn = dedupe(S.pool).length;
    drawWheel(el);
    wc.style.transform = "rotate(0rad)";
    win.textContent = pn
      ? S.prize
        ? "\ud83c\udf81 PRIZE: " + S.prize
        : ""
      : "Add participants in the Grand Raffle panel";
    el._sid = null;
  }
  if (isW && S.raffle) {
    const r = S.raffle,
      n = r.names.length,
      seg = (Math.PI * 2) / Math.max(n, 1),
      tg = -Math.PI / 2 - (r.names.indexOf(r.winner) + 0.5) * seg,
      D = (r.dur || 10) * 1000;
    drawWheel(el);
    if (el._sid !== r.spinId) {
      el._sid = r.spinId;
      win.textContent = r.prize ? "\ud83c\udf81 PRIZE: " + r.prize : "";
      const tw = Math.PI * 2,
        d = (Math.round((D / 1000) * 0.9) + 4) * tw + (((tg % tw) + tw) % tw),
        sid = r.spinId;
      (function f() {
        if (el._sid !== sid) return;
        const e = now() - r.spinId,
          p = Math.min(1, e / D);
        wc.style.transform = "rotate(" + d * (1 - Math.pow(1 - p, 4)) + "rad)";
        if (p < 1 || e < D + 2000) requestAnimationFrame(f);
        else reveal(el, r, e > D + 5500);
      })();
    }
  }
  // keep the prize line on one line: long prizes get a smaller font (about 0.6 em per character)
  if (isW && win._t !== win.textContent) {
    win._t = win.textContent;
    win.style.fontSize = Math.min(4, 84 / (0.6 * Math.max(win._t.length, 1))) + "cqw";
  }
}

export { FE, buildStage, tick, updateStage };
