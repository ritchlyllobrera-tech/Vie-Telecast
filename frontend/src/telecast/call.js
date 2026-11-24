/**
 * CEO live call: Teams, Google Meet and Zoom cannot be embedded in another page, so the Director
 * joins the meeting in a browser tab and shares that tab (picture + sound) with the app.
 *
 *   - the Director's own Live Screen (pop-out) gets the stream straight from the control room
 *   - every other screen / editor gets it over WebRTC, one peer connection per viewer,
 *     signalled through the Telecast server
 *
 * S.call = { live: <timestamp>, by: <name>, audio: <bool> } while sharing, otherwise null.
 */
import { S } from "./state.js";
import { LIVE, save } from "./sync.js";
import { render } from "./render.js";
import { NET, netSend } from "./net.js";

let local = null, // the Director's captured stream
  remote = null, // the stream received from the Director
  remoteTs = 0,
  wantAt = 0,
  waitFrom = 0; // Live screen: since when it has been waiting for the stream (0 = has it, or no call)
const peers = new Map(); // director: viewerId -> RTCPeerConnection; viewer: directorId -> RTCPeerConnection

export const callLive = () => !!(S.call && S.call.live);
export const sharing = () => !!local;
export const viewers = () => [...peers.values()].filter((pc) => pc.connectionState === "connected").length;
/** Live screen: how long it has been waiting for the call picture (0 = not waiting). */
export const callWait = () => (waitFrom ? Date.now() - waitFrom : 0);

/** The stream this window should show, if it has one. */
export function callStream() {
  if (local && local.active) return local;
  if (LIVE)
    try {
      const s = window.opener && window.opener.__tcStream;
      if (s && s.active) return s;
    } catch {
      /* opener from another origin */
    }
  return remote && remote.active ? remote : null;
}

/**
 * Browsers only allow sharing a tab on a secure address: https://… or http://localhost.
 * http://192.168.x.x:3010 (another computer on the network) is not one, so the button does nothing there.
 */
export const canShare = () => window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

/** Explains why sharing is blocked on this address and how to fix it. */
export function callHelp() {
  document.getElementById("callhelp")?.remove();
  const here = location.origin,
    lh = "http://localhost:" + (location.port || "80") + "/",
    edge = /Edg\//.test(navigator.userAgent),
    flags = (edge ? "edge" : "chrome") + "://flags/#unsafely-treat-insecure-origin-as-secure";
  const d = document.createElement("div");
  d.id = "callhelp";
  d.setAttribute("role", "dialog");
  d.innerHTML = `<div class="cc"><h3>📡 Sharing is blocked on this address</h3>
 <p>The browser only lets a page share a tab from a <b>secure address</b>. <code>${here}</code> is not one, so the call can't be sent to the Live Screens from here. Fix it with <b>one</b> of these:</p>
 <ol>
  <li><b>On the computer that runs the Telecast server</b>, open the control room at <code>${lh}</code> instead.${NET.samePc ? ` <button class="p" data-lh>🔁 Reopen at localhost now</button><br><span class="mut">This is that computer. You'll sign in again; the show is kept on the server.</span>` : ""}</li>
  <li><b>On any other computer</b>: open <code>${flags}</code> in the address bar, paste <code>${here}</code> into the box, set it to <b>Enabled</b>, then press <b>Relaunch</b>. <button data-cp>📋 Copy the address</button></li>
  <li><b>Across offices over the internet</b>: run the server behind an https:// address (a tunnel or hosting). Sharing then works from any computer.</li>
 </ol>
 <p class="mut">Live Screens don't need any of this. They only receive the call.</p>
 <div class="row" style="justify-content:flex-end"><button data-x>Close</button></div></div>`;
  document.body.appendChild(d);
  d.querySelector("[data-x]").onclick = () => d.remove();
  d.onclick = (e) => e.target === d && d.remove();
  const l = d.querySelector("[data-lh]");
  if (l) l.onclick = () => (location.href = lh);
  const c = d.querySelector("[data-cp]");
  c.onclick = () => {
    const ok = () => (c.textContent = "✔ Copied");
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(here).then(ok, () => {});
    else {
      // no clipboard API on an http address: copy through a hidden text box
      const t = document.createElement("textarea");
      t.value = here;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
        ok();
      } catch {
        /* the address is also shown above */
      }
      t.remove();
    }
  };
}

/** Director: pick the meeting tab / window and put it on every Live Screen. */
export async function startCall() {
  if (local) return;
  if (!window.isSecureContext) {
    callHelp();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("This browser cannot share a tab. Use Chrome or Edge on a Windows or Mac computer.");
    return;
  }
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
    });
  } catch {
    return; // cancelled
  }
  local = s;
  window.__tcStream = s;
  s.getVideoTracks()[0].addEventListener("ended", stopCall); // "Stop sharing" in the browser bar
  S.call = { live: Date.now(), by: (NET.you && NET.you.name) || "Director", audio: s.getAudioTracks().length > 0 };
  save();
}

/** Stop the local capture and every connection, without touching the shared state. */
export function stopLocalCall() {
  if (local) local.getTracks().forEach((t) => t.stop());
  local = null;
  window.__tcStream = null;
  for (const pc of peers.values()) pc.close();
  peers.clear();
}
export function stopCall() {
  stopLocalCall();
  if (S.call) {
    S.call = null;
    save();
  }
}

function newPc(to) {
  const pc = new RTCPeerConnection({ iceServers: NET.ice });
  pc.onicecandidate = (e) => e.candidate && netSend({ t: "rtc", to, ice: e.candidate });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      pc.close();
      if (peers.get(to) === pc) peers.delete(to);
    }
    render();
  };
  return pc;
}

/** Signalling messages relayed by the server. */
export async function onRtc(m) {
  if (m.t === "rtc-want") {
    // Director: a screen asks for the stream
    if (!local) return;
    if (peers.get(m.from)) peers.get(m.from).close();
    const pc = newPc(m.from);
    peers.set(m.from, pc);
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    await pc.setLocalDescription(await pc.createOffer());
    netSend({ t: "rtc", to: m.from, sdp: pc.localDescription });
    return;
  }
  let pc = peers.get(m.from);
  if (m.sdp && m.sdp.type === "offer") {
    // viewer: the Director is calling us
    if (pc) pc.close();
    pc = newPc(m.from);
    peers.set(m.from, pc);
    pc.ontrack = (e) => {
      remote = e.streams[0];
      render();
    };
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    netSend({ t: "rtc", to: m.from, sdp: pc.localDescription });
  } else if (m.sdp && pc) await pc.setRemoteDescription(m.sdp);
  else if (m.ice && pc)
    try {
      await pc.addIceCandidate(m.ice);
    } catch {
      /* late candidate */
    }
}

function dropRemote() {
  if (local) return;
  for (const pc of peers.values()) pc.close();
  peers.clear();
  if (remote) {
    remote = null;
    render();
  }
}
export function onDirectorLeft() {
  dropRemote();
}

/** Viewers: ask the Director for the stream whenever a call is live and we don't have it yet. */
export function onCallState() {
  if (local) return;
  if (!callLive()) {
    remoteTs = 0;
    waitFrom = 0;
    dropRemote();
    return;
  }
  if (remoteTs !== S.call.live) {
    remoteTs = S.call.live; // a new share: the old connection is useless
    dropRemote();
    wantAt = 0;
  }
  const had = !!waitFrom;
  waitFrom = callStream() || !LIVE ? 0 : waitFrom || Date.now();
  if (had !== !!waitFrom || waitFrom) render(); // the screen's "connecting…" message changes over time
  // only Live screens receive the call; control rooms watch it through "Pop-out Live Screen"
  if (callStream() || !NET.on || !LIVE) return;
  if (Date.now() - wantAt < 6000) return;
  wantAt = Date.now();
  netSend({ t: "rtc-want" });
}
setInterval(onCallState, 3000);
