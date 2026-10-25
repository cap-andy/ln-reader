const el = (id) => document.getElementById(id);

const statusMsg = el("statusMsg");
const topbarTitle = el("topbarTitle");

export function showStatus(message, isError = false) {
  statusMsg.textContent = message;
  statusMsg.classList.remove("hidden");
  statusMsg.classList.toggle("error", isError);
}

export function clearStatus() {
  statusMsg.classList.add("hidden");
}

export function setTopbarTitle(text) {
  topbarTitle.textContent = text || "";
}

const VIEW_IDS = ["view-home", "view-novel", "view-reader", "view-auth"];

/** Shows exactly one top-level view, hides the rest. */
export function showView(id) {
  for (const viewId of VIEW_IDS) {
    el(viewId).classList.toggle("hidden", viewId !== id);
  }
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

export function closeAllPanels() {
  el("bookmarksPanel").classList.add("hidden");
  el("settingsPanel").classList.add("hidden");
}
