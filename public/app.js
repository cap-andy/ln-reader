const el = (id) => document.getElementById(id);

const topbar = el("topbar");
const topbarTitle = el("topbarTitle");

const fetchWrap = el("fetchWrap");
const fetchToggleBtn = el("fetchToggleBtn");
const fetchBar = el("fetchBar");
const urlInput = el("urlInput");
const fetchBtn = el("fetchBtn");
const pasteModeBtn = el("pasteModeBtn");
const pasteBar = el("pasteBar");
const pasteArea = el("pasteArea");
const parsePasteBtn = el("parsePasteBtn");
const cancelPasteBtn = el("cancelPasteBtn");
const statusMsg = el("statusMsg");

const reader = el("reader");
const emptyState = el("emptyState");
const novelTitleEl = el("novelTitle");
const chapterTitleEl = el("chapterTitle");
const chapterContentEl = el("chapterContent");
const bottomSentinel = el("bottomSentinel");

const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");
const autoNextIndicator = el("autoNextIndicator");

const bookmarkCurrentBtn = el("bookmarkCurrentBtn");
const bookmarksToggle = el("bookmarksToggle");
const bookmarksPanel = el("bookmarksPanel");
const bookmarksList = el("bookmarksList");

const settingsToggle = el("settingsToggle");
const settingsPanel = el("settingsPanel");
const themeToggle = el("themeToggle");

const fontDown = el("fontDown");
const fontUp = el("fontUp");
const fontSizeLabel = el("fontSizeLabel");
const lineDown = el("lineDown");
const lineUp = el("lineUp");
const lineHeightLabel = el("lineHeightLabel");
const fontFamilySelect = el("fontFamilySelect");
const autoNextToggle = el("autoNextToggle");

// ---------------------------------------------------------------------------
// Settings persistence (localStorage — purely client-side display prefs)
// ---------------------------------------------------------------------------

const settings = {
  dark: localStorage.getItem("ln.dark") === "1",
  fontSize: parseInt(localStorage.getItem("ln.fontSize") || "18", 10),
  lineHeight: parseFloat(localStorage.getItem("ln.lineHeight") || "1.75"),
  fontFamily: localStorage.getItem("ln.fontFamily") || "georgia",
  autoNext: localStorage.getItem("ln.autoNext") === "1",
};

const FONT_MAP = {
  georgia: "var(--font-reading)",
  literata: "var(--font-reading-literata)",
  merriweather: "var(--font-reading-merriweather)",
  "source-serif": "var(--font-reading-source-serif)",
  bitter: "var(--font-reading-bitter)",
  atkinson: "var(--font-reading-atkinson)",
};

function applySettings() {
  document.body.classList.toggle("dark", settings.dark);
  chapterContentEl.style.fontSize = `${settings.fontSize}px`;
  chapterContentEl.style.lineHeight = String(settings.lineHeight);
  chapterContentEl.style.fontFamily = FONT_MAP[settings.fontFamily] || FONT_MAP.georgia;
  fontSizeLabel.textContent = `${settings.fontSize}px`;
  lineHeightLabel.textContent = settings.lineHeight.toFixed(1);
  fontFamilySelect.value = settings.fontFamily;
  autoNextToggle.checked = settings.autoNext;
}

function saveSettings() {
  localStorage.setItem("ln.dark", settings.dark ? "1" : "0");
  localStorage.setItem("ln.fontSize", String(settings.fontSize));
  localStorage.setItem("ln.lineHeight", String(settings.lineHeight));
  localStorage.setItem("ln.fontFamily", settings.fontFamily);
  localStorage.setItem("ln.autoNext", settings.autoNext ? "1" : "0");
}

themeToggle.addEventListener("click", () => {
  settings.dark = !settings.dark;
  applySettings();
  saveSettings();
});

fontDown.addEventListener("click", () => {
  settings.fontSize = Math.max(14, settings.fontSize - 1);
  applySettings();
  saveSettings();
});
fontUp.addEventListener("click", () => {
  settings.fontSize = Math.min(32, settings.fontSize + 1);
  applySettings();
  saveSettings();
});
lineDown.addEventListener("click", () => {
  settings.lineHeight = Math.max(1.2, +(settings.lineHeight - 0.1).toFixed(1));
  applySettings();
  saveSettings();
});
lineUp.addEventListener("click", () => {
  settings.lineHeight = Math.min(2.2, +(settings.lineHeight + 0.1).toFixed(1));
  applySettings();
  saveSettings();
});
fontFamilySelect.addEventListener("change", () => {
  settings.fontFamily = fontFamilySelect.value;
  applySettings();
  saveSettings();
});
autoNextToggle.addEventListener("change", () => {
  settings.autoNext = autoNextToggle.checked;
  saveSettings();
});

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  bookmarksPanel.classList.add("hidden");
});
bookmarksToggle.addEventListener("click", () => {
  bookmarksPanel.classList.toggle("hidden");
  settingsPanel.classList.add("hidden");
  if (!bookmarksPanel.classList.contains("hidden")) loadBookmarks();
});

const settingsCloseBtn = el("settingsCloseBtn");
const bookmarksCloseBtn = el("bookmarksCloseBtn");

settingsCloseBtn.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});
bookmarksCloseBtn.addEventListener("click", () => {
  bookmarksPanel.classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (
    !settingsPanel.classList.contains("hidden") &&
    !settingsPanel.contains(e.target) &&
    e.target !== settingsToggle &&
    !settingsToggle.contains(e.target)
  ) {
    settingsPanel.classList.add("hidden");
  }
  if (
    !bookmarksPanel.classList.contains("hidden") &&
    !bookmarksPanel.contains(e.target) &&
    e.target !== bookmarksToggle &&
    !bookmarksToggle.contains(e.target)
  ) {
    bookmarksPanel.classList.add("hidden");
  }
});

applySettings();

// ---------------------------------------------------------------------------
// Fetch dropdown (extends from / retracts into the Fetch button)
// ---------------------------------------------------------------------------

function openFetchBar() {
  fetchBar.classList.add("open");
  urlInput.focus();
}
function closeFetchBar() {
  fetchBar.classList.remove("open");
}

fetchToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (fetchBar.classList.contains("open")) {
    closeFetchBar();
  } else {
    openFetchBar();
  }
});

document.addEventListener("click", (e) => {
  if (fetchBar.classList.contains("open") && !fetchWrap.contains(e.target)) {
    closeFetchBar();
  }
});

// ---------------------------------------------------------------------------
// Auto-hide top bar once the article has scrolled up beneath it
// ---------------------------------------------------------------------------

let lastScrollY = window.scrollY;
let topbarHeight = topbar.offsetHeight;
let scrollTicking = false;

function updateTopbarHeight() {
  topbarHeight = topbar.offsetHeight;
}
window.addEventListener("resize", updateTopbarHeight);

function handleTopbarScroll() {
  const currentY = window.scrollY;
  const delta = currentY - lastScrollY;
  const pastThreshold = currentY > topbarHeight;
  const hasArticle = !reader.classList.contains("hidden");

  if (hasArticle && pastThreshold) {
    if (delta > 2) {
      topbar.classList.add("topbar-hidden");
      closeFetchBar();
    } else if (delta < -2) {
      topbar.classList.remove("topbar-hidden");
    }
  } else {
    topbar.classList.remove("topbar-hidden");
  }

  lastScrollY = currentY;
  scrollTicking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (!scrollTicking) {
      requestAnimationFrame(handleTopbarScroll);
      scrollTicking = true;
    }
  },
  { passive: true }
);

// ---------------------------------------------------------------------------
// Arrow-key chapter navigation
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "ArrowLeft" && !prevBtn.disabled) {
    e.preventDefault();
    prevBtn.click();
  } else if (e.key === "ArrowRight" && !nextBtn.disabled) {
    e.preventDefault();
    nextBtn.click();
  }
});

// ---------------------------------------------------------------------------
// Status / error display
// ---------------------------------------------------------------------------

function showStatus(message, isError = false) {
  statusMsg.textContent = message;
  statusMsg.classList.remove("hidden");
  statusMsg.classList.toggle("error", isError);
}
function clearStatus() {
  statusMsg.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Chapter loading
// ---------------------------------------------------------------------------

let current = null; // last parsed chapter object
let progressSaveTimer = null;

async function loadChapterByUrl(url) {
  clearStatus();
  showStatus("Fetching chapter…");
  try {
    const res = await fetch(`/api/chapter?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) {
      showStatus(data.error || "Fetch failed. Try pasting the page source instead.", true);
      pasteBar.classList.remove("hidden");
      return;
    }
    renderChapter(data);
    clearStatus();
  } catch (err) {
    showStatus("Network error reaching the local server: " + err.message, true);
  }
}

async function parsePastedHtml(html, url) {
  clearStatus();
  showStatus("Parsing pasted HTML…");
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, url: url || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      showStatus(data.error || "Could not parse that HTML.", true);
      return;
    }
    renderChapter(data);
    pasteBar.classList.add("hidden");
    pasteArea.value = "";
    clearStatus();
  } catch (err) {
    showStatus("Network error reaching the local server: " + err.message, true);
  }
}

function renderChapter(data) {
  current = data;

  emptyState.classList.add("hidden");
  reader.classList.remove("hidden");
  bookmarkCurrentBtn.disabled = false;

  novelTitleEl.textContent = data.novelTitle || "";
  chapterTitleEl.textContent = data.chapterTitle || "";
  topbarTitle.textContent = data.chapterTitle || "";
  chapterContentEl.innerHTML = "";
  for (const para of data.paragraphs) {
    const p = document.createElement("p");
    p.textContent = para;
    chapterContentEl.appendChild(p);
  }

  prevBtn.disabled = !data.prevChapter?.url;
  nextBtn.disabled = !data.nextChapter?.url;
  prevBtn.dataset.url = data.prevChapter?.url || "";
  nextBtn.dataset.url = data.nextChapter?.url || "";

  urlInput.value = data.chapterUrl || "";

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  lastScrollY = 0;
  topbar.classList.remove("topbar-hidden");
  closeFetchBar();
  maybeOfferResume();
  observeAutoNext();
}

fetchBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (url) loadChapterByUrl(url);
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchBtn.click();
});

pasteModeBtn.addEventListener("click", () => pasteBar.classList.toggle("hidden"));
cancelPasteBtn.addEventListener("click", () => pasteBar.classList.add("hidden"));
parsePasteBtn.addEventListener("click", () => {
  const html = pasteArea.value.trim();
  if (!html) return showStatus("Paste the page source first.", true);
  parsePastedHtml(html, urlInput.value.trim() || null);
});

prevBtn.addEventListener("click", () => {
  if (prevBtn.dataset.url) loadChapterByUrl(prevBtn.dataset.url);
});
nextBtn.addEventListener("click", () => {
  if (nextBtn.dataset.url) loadChapterByUrl(nextBtn.dataset.url);
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

bookmarkCurrentBtn.addEventListener("click", async () => {
  if (!current?.chapterId) return;
  await fetch("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chapterId: current.chapterId,
      chapterTitle: current.chapterTitle,
      novelTitle: current.novelTitle,
      url: current.chapterUrl,
    }),
  });
  bookmarkCurrentBtn.textContent = "★ Saved";
  setTimeout(() => (bookmarkCurrentBtn.textContent = "★ Bookmark this chapter"), 1200);
});

async function loadBookmarks() {
  const res = await fetch("/api/bookmarks");
  const bookmarks = await res.json();
  bookmarksList.innerHTML = "";
  if (bookmarks.length === 0) {
    bookmarksList.innerHTML = `<li style="cursor:default">No bookmarks yet.</li>`;
    return;
  }
  for (const b of bookmarks) {
    const li = document.createElement("li");
    li.innerHTML = `
      <button class="bm-remove" data-id="${b.chapterId}" title="Remove">✕</button>
      <div class="bm-novel">${b.novelTitle || ""}</div>
      <div>${b.chapterTitle || b.url}</div>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".bm-remove")) return;
      loadChapterByUrl(b.url);
    });
    bookmarksList.appendChild(li);
  }
  bookmarksList.querySelectorAll(".bm-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/bookmarks/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
      loadBookmarks();
    });
  });
}

// ---------------------------------------------------------------------------
// Reading progress (scroll position within the article, saved per chapter)
// ---------------------------------------------------------------------------

function currentScrollPercent() {
  const total = document.body.scrollHeight - window.innerHeight;
  if (total <= 0) return 100;
  const percent = (window.scrollY / total) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

// Last percent actually written per chapter, so an unchanged scroll
// position (e.g. tiny jitter, or scrolling back to a spot already saved)
// doesn't trigger a redundant localStorage write + network request.
const lastSavedPercent = {};

// The chapter+meta a pending debounced save is for, captured at the moment
// the save is scheduled - not read fresh when the timer fires. Without
// this, switching chapters while a save is still pending (e.g. clicking
// Next within the debounce window) would write the new chapter's scroll
// position (usually 0, right after auto-scroll-to-top) under the OLD
// chapter's id.
let pendingSave = null;

function doSaveProgress(chapterId, percent, meta, keepalive = false) {
  if (lastSavedPercent[chapterId] === percent) return;
  lastSavedPercent[chapterId] = percent;

  localStorage.setItem(`ln.progress.${chapterId}`, String(percent));

  fetch(`/api/progress/${encodeURIComponent(chapterId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // keepalive lets this request complete even if the tab is being
    // closed/navigated away from right as it fires (used for the
    // beforeunload/visibilitychange flush below).
    keepalive,
    body: JSON.stringify({
      percent,
      novelTitle: meta.novelTitle,
      chapterTitle: meta.chapterTitle,
      url: meta.chapterUrl,
    }),
  }).catch((err) => {
    // Swallow network errors here (progress saving should never interrupt
    // reading), but don't pretend it succeeded - let the next scroll event
    // retry, since lastSavedPercent was already updated optimistically.
    // Roll it back so a genuine retry is still attempted.
    if (lastSavedPercent[chapterId] === percent) {
      delete lastSavedPercent[chapterId];
    }
    console.warn("Failed to save reading progress:", err);
  });
}

function saveProgressDebounced() {
  if (!current?.chapterId) return;
  const chapterId = current.chapterId;
  const meta = {
    novelTitle: current.novelTitle,
    chapterTitle: current.chapterTitle,
    chapterUrl: current.chapterUrl,
  };
  const percent = currentScrollPercent();

  if (lastSavedPercent[chapterId] === percent) return;

  pendingSave = { chapterId, percent, meta };
  clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    if (!pendingSave) return;
    doSaveProgress(pendingSave.chapterId, pendingSave.percent, pendingSave.meta);
    pendingSave = null;
  }, 500);
}

function flushPendingProgressSave() {
  if (!pendingSave) return;
  clearTimeout(progressSaveTimer);
  doSaveProgress(pendingSave.chapterId, pendingSave.percent, pendingSave.meta, true);
  pendingSave = null;
}

window.addEventListener("scroll", () => {
  saveProgressDebounced();
});

// Flush any pending (debounced but not-yet-sent) save the moment the tab
// is hidden or closed, so switching apps or closing mid-chapter doesn't
// lose up to 500ms of the most recent scroll position.
window.addEventListener("beforeunload", flushPendingProgressSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingProgressSave();
});

async function maybeOfferResume() {
  if (!current?.chapterId) return;
  let percent = localStorage.getItem(`ln.progress.${current.chapterId}`);
  if (!percent) {
    try {
      const res = await fetch(`/api/progress/${encodeURIComponent(current.chapterId)}`);
      const data = await res.json();
      percent = data?.percent ?? null;
    } catch {
      percent = null;
    }
  }
  if (percent && Number(percent) > 5 && Number(percent) < 95) {
    const target = (Number(percent) / 100) * (document.body.scrollHeight - window.innerHeight);
    window.scrollTo({ top: target, behavior: "smooth" });
  }
}

// ---------------------------------------------------------------------------
// Auto-load next chapter near the bottom
// ---------------------------------------------------------------------------

let autoNextObserver = null;
let autoNextTriggered = false;

function observeAutoNext() {
  if (autoNextObserver) autoNextObserver.disconnect();
  autoNextTriggered = false;
  autoNextIndicator.classList.add("hidden");

  autoNextObserver = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      if (!settings.autoNext) return;
      if (autoNextTriggered) return;
      if (!nextBtn.dataset.url) return;

      autoNextTriggered = true;
      autoNextIndicator.classList.remove("hidden");
      setTimeout(() => {
        loadChapterByUrl(nextBtn.dataset.url);
      }, 900);
    },
    { rootMargin: "200px" }
  );
  autoNextObserver.observe(bottomSentinel);
}

// ---------------------------------------------------------------------------
// Resume shortcut on load: if nothing in the URL bar, offer the last chapter
// ---------------------------------------------------------------------------

(async function init() {
  try {
    const res = await fetch("/api/continue");
    const last = await res.json();
    if (last?.url) {
      showStatus(`Resume "${last.chapterTitle || last.url}"? Click Fetch to continue, or paste a new URL.`);
      urlInput.value = last.url;
    }
  } catch {
    // Backend not reachable yet / no history — fine, just show the empty state.
  }
})();
