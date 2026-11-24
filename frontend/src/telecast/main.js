/**
 * Entry point of the Telecast engine. Import this only after the #app element exists:
 * the modules register their listeners / timers when they are first evaluated.
 *
 * The same page serves two roles:
 *   - control room  (default URL)
 *   - live screen   (URL ending in #live, or the pop-out window named "VienovoLive")
 */
import { DEF } from "./constants.js";
import { S, setS, fixSegs } from "./state.js";
import { LIVE } from "./sync.js";
import { tx } from "./media.js";
import { render } from "./render.js";
import { loadInitialState } from "./persistence.js";
import { holdOnOpen } from "./actions.js";
import { netStart, NET } from "./net.js";

let started = false;

export function startTelecast() {
  if (started) return;
  started = true;
  // read-only copy of the current state, for checking a screen from the browser console / tests
  window.vtcState = () => JSON.parse(JSON.stringify(S));
  render();
  netStart(); // multi-user mode when the Telecast server is running (otherwise: this computer only)
  if (LIVE) return;
  loadInitialState();
  holdOnOpen(); // opening the page never starts the program (nor an Editor's own flow) - use Start / Resume
  // a newer copy of the state may be in IndexedDB (written on every save)
  tx("readonly", (s) => s.get("state"))
    .then((r) => {
      if (NET.on) return; // the shared server state wins
      try {
        const o = r && JSON.parse(r.json);
        if (o && (o.savedAt || 0) > (S.savedAt || 0)) {
          setS({ ...DEF, ...o });
          fixSegs();
          holdOnOpen();
          render();
        }
      } catch {
        /* ignore corrupt saves */
      }
    })
    .catch(() => {});
}
