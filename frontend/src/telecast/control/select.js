/**
 * Click-to-select for media items: an item's ✕ (delete / remove) button stays hidden until the item is
 * clicked. Items carry data-sel="<key>" and get the class "xon" while selected; their ✕ has class "xs".
 * Clicking anywhere outside a selectable item clears the selection.
 */
import { render } from "../render.js";

let sel = "";
/** " xon" when the item with this key is selected (for the item's class list) */
export const xon = (key) => (sel === key ? " xon" : "");

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element) || t.closest(".xs")) return; // the ✕ itself: its own handler decides
  const it = t.closest("[data-sel]"),
    k = it ? it.dataset.sel : "";
  if (k === sel) return;
  sel = k;
  render();
});
