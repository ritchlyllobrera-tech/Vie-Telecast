/** Static configuration: asset URLs, default rundown, scene names, palette and tiny helpers. */

const LOGO = "/assets/logo.png",
  BG0 = "/assets/background-default.jpg";
const RAFM = "/assets/raffle-default.m4a";
const K = "vtc_state_v2",
  $ = (r, s) => r.querySelector(s),
  esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SEGS = [
  ["Pre-show Standby", 3, "Standby loop while guests arrive"],
  ["Opening Video", 4.37, "Countdown and opening AVP"],
  ["Welcome & Invocation", 5, "Host welcome and opening prayer"],
  ["Employee Awards", 25, "Service and performance awards"],
  ["Games & Fellowship", 20, "Group games across all hubs"],
  ["CEO Message", 6, "Year-end message from the CEO"],
  ["Hub Greetings: Cebu · NCR · CDO", 10, "Greetings from each hub"],
  ["Performances", 20, "Production numbers"],
  ["Grand Raffle", 25, "Spin the wheel for prizes"],
  ["Closing & Group Photo", 5, "Thank you and send-off"],
];
const SCENES = {
  standby: "Standby",
  "live-feed": "Live Feed",
  "ceo-video": "CEO Video",
  "opening-video": "Opening Video",
  "segment-video": "Segment Video",
  "spin-wheel": "Spin the Wheel",
};
const DEF = {
  seg: 0,
  edit: 0,
  scene: "standby",
  auto: true, // a segment picks its own screen (video, wheel, live feed) when it starts
  autoTime: false, // ⏰ follow the schedule: segments with a set clock time start at that time (off while testing)
  running: false,
  started: 0,
  ticker:
    "Welcome to Vienovo Philippines Inc. Year End and Christmas Party 2026! Enjoy the celebration, fellowship, games, and awards.",
  segs: SEGS.map((s, i) => ({
    id: "seg-" + (i + 1),
    title: s[0],
    min: s[1],
    desc: s[2],
    time: "",
    av: false,
    bg: null,
  })),
  awards: [],
  awFolders: [], // award folders in order (an empty folder is kept until employees are added)
  awTitle: {}, // folder name -> the award shown on the Live Screen (the folder name when not set)
  awLoc: {}, // folder name -> location key (cebu / ncr / cdo); not set = all locations
  pool: "",
  pools: {}, // raffle names per location: { cebu: "…", ncr: "…", cdo: "…" }
  prizes: {}, // prize for the next spin, per location
  rafLoc: "", // the location this computer's raffle runs for (an Editor: their own)
  winners: [],
  spot: -1,
  shuf: {}, // 🔀 shuffle the songs of a segment: { segId: true } (each control room's own choice)
  spotList: null, // { award, page, ts }: the Live Screen lists an award's awardees, PER names per page
  raffle: null,
  segStart: Date.now(),
  t0: Date.now(),
  media: [],
  cmd: null,
};
// the venues of the show. Each person signs in at one; a segment can belong to one ("" = all locations)
const LOCS = { cebu: "Cebu City", ncr: "NCR Makati", cdo: "CDO Mindanao" };
// medal for an employee award (optional: "" = no medal)
// names per page when an award's awardees are listed on the Live Screen (the list option shows above this many)
const PER = 20;
const MEDAL = { gold: ["🥇", "Gold"], silver: ["🥈", "Silver"], bronze: ["🥉", "Bronze"] };
const MB = (b) => (b / 1048576).toFixed(1) + " MB";
const fm = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
const fmt = (ms) => {
  const s = Math.floor(Math.abs(ms) / 1000);
  return (
    String(Math.floor(s / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor((s % 3600) / 60)).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};
const WP = [
  ["#1e3a8a", "#fff"],
  ["#bae6fd", "#0b2a4a"],
  ["#2563eb", "#fff"],
  ["#f8fafc", "#0b2a4a"],
  ["#0d9488", "#fff"],
  ["#c4b5fd", "#2e1065"],
  ["#38bdf8", "#052a44"],
  ["#cbd5e1", "#0f172a"],
  ["#166534", "#fff"],
  ["#99f6e4", "#064e3b"],
  ["#be123c", "#fff"],
  ["#fde68a", "#5b3a00"],
];
const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A meeting link as typed (e.g. "meet.google.com/abc-defg-hij") -> a full https:// link, or "" if it is not one. */
const meetLink = (s) => {
  let u = String(s || "").trim();
  if (!u) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  u = u.replace(/^http:/i, "https:");
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /\.[a-z]{2,}$/i.test(x.hostname) ? x.href : "";
  } catch {
    return "";
  }
};
/** Which platform a meeting link belongs to: teams | meet | zoom | "" (unknown). */
const meetPlat = (s) => {
  const u = meetLink(s);
  if (!u) return "";
  const h = new URL(u).hostname.toLowerCase();
  if (/(^|\.)teams\.(microsoft|live)\.com$/.test(h) || /(^|\.)teams\.microsoft\.us$/.test(h)) return "teams";
  if (h === "meet.google.com") return "meet";
  if (/(^|\.)zoom\.(us|com)$/.test(h)) return "zoom";
  return "";
};
/** YouTube video id from watch?v= / youtu.be / live / embed / shorts links, or a bare 11-character id ("" if none). */
const ytId = (s) => {
  const t = String(s || "").trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const u = meetLink(t);
  if (!u) return "";
  const x = new URL(u),
    h = x.hostname.toLowerCase(),
    ok = (v) => (/^[\w-]{11}$/.test(v || "") ? v : "");
  if (h === "youtu.be") return ok(x.pathname.split("/")[1]);
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
    const m = x.pathname.match(/^\/(?:live|embed|shorts|v)\/([^/?#]+)/);
    return m ? ok(m[1]) : ok(x.searchParams.get("v"));
  }
  return "";
};

export { LOGO, BG0, RAFM, K, $, esc, SEGS, SCENES, DEF, LOCS, MEDAL, PER, MB, fm, fmt, WP, norm, meetLink, meetPlat, ytId };
