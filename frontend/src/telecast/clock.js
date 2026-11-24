/**
 * One clock for every location: the Telecast server's.
 *
 * Countdowns, the "Up" timer and the raffle wheel compare the time stamped by the Director's PC
 * (S.segStart, S.t0, raffle.spinId) with the time on each screen. If a PC's own clock is a few seconds
 * off, its countdown would be too. With a server, every PC measures how far its clock is from the
 * server's (network delay subtracted) and uses that corrected time, so all locations show the same.
 * Without a server (one computer) the offset stays 0.
 */
let offset = 0,
  best = Infinity; // smallest round trip seen recently: the most accurate sample

/** The show time (milliseconds), the same at every location. */
export const now = () => Date.now() + offset;

/** Ask the server for its time. `send` is net.js's netSend. */
export function askTime(send) {
  send({ t: "time", c: Date.now() });
}

/** Server answer: { c: our send time, s: server time }. */
export function onTime(m) {
  const back = Date.now(),
    rtt = back - m.c;
  if (rtt < 0 || rtt > 5000) return;
  // trust a sample only if its round trip is close to the best one (a slow answer is less precise)
  if (rtt <= best * 1.5 + 20) {
    best = Math.min(best, rtt);
    offset = Math.round(m.s - (m.c + back) / 2);
  }
}
/** after a reconnect the network path may have changed */
export function resetClock() {
  best = Infinity;
}
