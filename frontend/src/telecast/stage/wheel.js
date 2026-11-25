/** Grand-raffle spin wheel, winner reveal card and confetti. */
import { $, esc, WP } from "../constants.js";
import { S, dedupe, poolText } from "../state.js";
import { now } from "../clock.js";

function drawWheel(el) {
  const names = S.raffle ? S.raffle.names : dedupe(poolText()),
    key = names.join("|"),
    cv = $(el, ".wheelbox canvas");
  if (el._wk === key) return;
  el._wk = key;
  const c = cv.getContext("2d"),
    n = names.length,
    R = 330;
  c.clearRect(0, 0, 700, 700);
  if (!n) return;
  const a = (Math.PI * 2) / n;
  c.save();
  c.translate(350, 350);
  for (let i = 0; i < n; i++) {
    let k = i % WP.length;
    if (i === n - 1 && n > 1 && k === 0) k = 3;
    const bg = WP[k][0],
      fg = WP[k][1];
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, R, i * a, (i + 1) * a);
    c.closePath();
    c.fillStyle = bg;
    c.fill();
    c.strokeStyle = "#ffffffaa";
    c.lineWidth = 2;
    c.stroke();
    c.save();
    c.rotate((i + 0.5) * a);
    c.fillStyle = fg;
    c.textAlign = "right";
    c.textBaseline = "middle";
    let f = Math.max(14, Math.min(34, 520 / n));
    c.font = "700 " + f + "px Montserrat,system-ui";
    const tx2 = names[i].slice(0, 24),
      w = c.measureText(tx2).width;
    if (w > R - 90) {
      f *= (R - 90) / w;
      c.font = "700 " + f + "px Montserrat,system-ui";
    }
    c.fillText(tx2, R - 26, 0);
    c.restore();
  }
  c.restore();
  c.save();
  c.translate(350, 350);
  c.lineWidth = 14;
  c.strokeStyle = "#e2e8f0";
  c.beginPath();
  c.arc(0, 0, R + 4, 0, 7);
  c.stroke();
  const g = c.createRadialGradient(0, 0, 4, 0, 0, 36);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#7dd3fc");
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 34, 0, 7);
  c.fill();
  c.restore();
}
function reveal(el, r, q) {
  const w = $(el, ".wn"),
    pz = $(el, ".wn .pz");
  $(el, ".wn .rd").textContent = "\u2744 ROUND " + r.round + " WINNER! \u2744";
  {
    const nm = $(el, ".wn .nm"),
      L = Math.max(r.winner.length, 1);
    let k = 0;
    nm.style.fontSize = Math.max(2.8, Math.min(4.6, 100 / L)) + "cqw";
    nm.innerHTML = r.winner
      .split(" ")
      .map(
        (w) =>
          '<b class="w">' +
          [...w]
            .map((ch) => '<span style="animation-delay:' + (0.5 + k++ * 0.05) + 's">' + esc(ch) + "</span>")
            .join("") +
          "</b>",
      )
      .join(" ");
  }
  pz.innerHTML = r.prize ? "<b>PRIZE:</b> " + esc(r.prize) : "";
  pz.style.display = r.prize ? "block" : "none";
  el._rev = r.spinId;
  w.style.display = "flex";
  $(el, ".wn .nm").style.animationDelay = -(Date.now() % 1800) / 1000 + "s";
  if (!q) confetti(el, r.spinId + (r.dur || 10) * 1000 + 2000);
}
function confetti(el, t0) {
  const cv = $(el, ".cf"),
    w = (cv.width = cv.clientWidth || 640),
    h = (cv.height = cv.clientHeight || 360),
    c = cv.getContext("2d"),
    k = w / 900,
    R = (i, n) => {
      const q = Math.sin(i * 91.3 + n * 17.7) * 43758.5453;
      return q - Math.floor(q);
    },
    P = Array.from({ length: 90 }, (_, i) => {
      const a = R(i, 1) * Math.PI * 2,
        sp = 3 + R(i, 2) * 9;
      return {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 4,
        r: 2 + R(i, 3) * 4.5,
        t: i % 3,
        c: ["#ffffff", "#bae6fd", "#7dd3fc", "#fde68a"][i % 4],
        s: R(i, 4) * 6,
      };
    });
  let fr = 0;
  (function f() {
    const e = (now() - t0) / 16.67;
    if (e < 0 || e > 330) {
      c.clearRect(0, 0, w, h);
      return;
    }
    requestAnimationFrame(f);
    if (++fr % 2) return;
    c.clearRect(0, 0, w, h);
    c.globalAlpha = e > 260 ? Math.max(0, 1 - (e - 260) / 70) : 1;
    for (const p of P) {
      const d = Math.min(e, 70),
        x = w / 2 + p.vx * d * k * (1 + Math.max(0, e - 70) * 0.002) + (e > 40 ? Math.sin(e / 14 + p.s) * 5 * k : 0),
        y = h * 0.5 + (p.vy * d + 0.025 * e * e) * k;
      if (p.t === 0) {
        c.strokeStyle = p.c;
        c.lineWidth = Math.max(1, p.r * 0.36 * k);
        c.save();
        c.translate(x, y);
        c.rotate(e / 40 + p.s);
        c.beginPath();
        const L = p.r * 2.4 * k;
        for (let q = 0; q < 3; q++) {
          const a = (q * Math.PI) / 3;
          c.moveTo(Math.cos(a) * L, Math.sin(a) * L);
          c.lineTo(-Math.cos(a) * L, -Math.sin(a) * L);
        }
        c.stroke();
        c.restore();
      } else {
        c.fillStyle = p.c;
        c.beginPath();
        c.arc(x, y, p.r * k * (p.t === 1 ? 0.8 : 0.5), 0, 7);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  })();
}

export { drawWheel, reveal, confetti };
