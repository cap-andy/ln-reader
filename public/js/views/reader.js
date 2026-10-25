import { api } from "../api.js";
import { state, settings } from "../state.js";
import { navigate } from "../router.js";
import { showStatus, clearStatus, setTopbarTitle, showView } from "../ui.js";

const el = (id) => document.getElementById(id);

const reader = el("reader");
const novelTitleEl = el("novelTitle");
const chapterTitleEl = el("chapterTitle");
const chapterContentEl = el("chapterContent");
const bottomSentinel = el("bottomSentinel");

const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");
const autoNextIndicator = el("autoNextIndicator");

// The chapter + the novel it belongs to, for the currently-rendered chapter.
let current = null; // parsed chapter object from the API
let currentNovelId = null;

export function getCurrentChapter() {
  return current ? { ...current, novelId: currentNovelId } : null;
}

// ---------------------------------------------------------------------------
// Loading a chapter: either by URL (cache-first, via the server) or with
// already-parsed data in hand (e.g. the novel page's paste-HTML fallback).
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.novelId
 * @param {string} [opts.novelTitle] - used for the "back" context; fetched if omitted
 * @param {string} [opts.chapterUrl] - fetch this chapter (cache-first)
 * @param {object} [opts.chapterData] - already-parsed chapter data to render directly
 */
export async function mountReaderView({ novelId, novelTitle, chapterUrl, chapterData }) {
  showView("view-reader");
  currentNovelId = novelId;
  clearStatus();

  if (chapterData) {
    renderChapter(chapterData);
    return;
  }

  if (!chapterUrl) {
    showStatus("No chapter to show — pick one from the novel's chapter list.", true);
    return;
  }

  showStatus("Fetching chapter…");
  try {
    const data = await api.fetchChapter(chapterUrl);
    clearStatus();
    renderChapter(data);
  } catch (err) {
    showStatus(err.message || "Fetch failed.", true);
  }
}

function renderChapter(data) {
  current = data;

  novelTitleEl.textContent = data.novelTitle || "";
  novelTitleEl.onclick = currentNovelId ? () => navigate(`/novel/${encodeURIComponent(currentNovelId)}`) : null;
  chapterTitleEl.textContent = data.chapterTitle || "";
  setTopbarTitle(data.chapterTitle || "");
  chapterContentEl.innerHTML = "";
  for (const para of data.paragraphs || []) {
    const p = document.createElement("p");
    p.textContent = para;
    chapterContentEl.appendChild(p);
  }

  prevBtn.disabled = !data.prevChapter?.url;
  nextBtn.disabled = !data.nextChapter?.url;
  prevBtn.dataset.url = data.prevChapter?.url || "";
  nextBtn.dataset.url = data.nextChapter?.url || "";

  el("bookmarkCurrentBtn").disabled = !data.chapterId || !state.user;

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  maybeOfferResume();
  observeAutoNext();
}

prevBtn.addEventListener("click", () => {
  if (prevBtn.dataset.url) goToChapterUrl(prevBtn.dataset.url);
});
nextBtn.addEventListener("click", () => {
  if (nextBtn.dataset.url) goToChapterUrl(nextBtn.dataset.url);
});

function goToChapterUrl(url) {
  navigate(`/novel/${encodeURIComponent(currentNovelId)}/read`, { url });
}

document.addEventListener("keydown", (e) => {
  if (el("view-reader").classList.contains("hidden")) return;
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
// Reading progress — per logged-in user, per novel. Saves the current
// chapter + scroll percent so you can resume each novel independently.
// (A separate, purely local cache of scroll-position-within-a-chapter is
// also kept so re-opening the exact same chapter resumes instantly,
// without waiting on a network round trip.)
// ---------------------------------------------------------------------------

function currentScrollPercent() {
  const total = document.body.scrollHeight - window.innerHeight;
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((window.scrollY / total) * 100)));
}

const lastSavedPercent = {}; // novelId -> last percent actually written
let pendingSave = null; // captured novelId/chapterId/percent/meta for the debounce timer
let progressSaveTimer = null;

function doSaveProgress(novelId, chapterId, percent, meta, keepalive = false) {
  if (!state.user) return;
  if (lastSavedPercent[novelId] === percent) return;
  lastSavedPercent[novelId] = percent;

  localStorage.setItem(`ln.progress.chapter.${chapterId}`, String(percent));

  fetch(`/api/progress/${encodeURIComponent(novelId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive,
    body: JSON.stringify({
      chapterId,
      chapterTitle: meta.chapterTitle,
      chapterUrl: meta.chapterUrl,
      novelTitle: meta.novelTitle,
      percent,
    }),
  }).catch((err) => {
    if (lastSavedPercent[novelId] === percent) delete lastSavedPercent[novelId];
    console.warn("Failed to save reading progress:", err);
  });
}

function saveProgressDebounced() {
  if (!current?.chapterId || !currentNovelId || !state.user) return;
  const novelId = currentNovelId;
  const chapterId = current.chapterId;
  const meta = {
    chapterTitle: current.chapterTitle,
    chapterUrl: current.chapterUrl,
    novelTitle: current.novelTitle,
  };
  const percent = currentScrollPercent();

  if (lastSavedPercent[novelId] === percent) return;

  pendingSave = { novelId, chapterId, percent, meta };
  clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    if (!pendingSave) return;
    doSaveProgress(pendingSave.novelId, pendingSave.chapterId, pendingSave.percent, pendingSave.meta);
    pendingSave = null;
  }, 500);
}

function flushPendingProgressSave() {
  if (!pendingSave) return;
  clearTimeout(progressSaveTimer);
  doSaveProgress(pendingSave.novelId, pendingSave.chapterId, pendingSave.percent, pendingSave.meta, true);
  pendingSave = null;
}

window.addEventListener("scroll", () => {
  if (!el("view-reader").classList.contains("hidden")) saveProgressDebounced();
});
window.addEventListener("beforeunload", flushPendingProgressSave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingProgressSave();
});

async function maybeOfferResume() {
  if (!current?.chapterId) return;

  let percent = localStorage.getItem(`ln.progress.chapter.${current.chapterId}`);

  // Only resume from the server's novel-level progress if it's actually
  // pointing at the chapter we're currently showing — otherwise this is a
  // different chapter in the same novel, and resuming mid-scroll would be
  // disorienting rather than helpful.
  if (!percent && state.user && currentNovelId) {
    try {
      const saved = await api.getProgress(currentNovelId);
      if (saved && saved.chapterId === current.chapterId) percent = saved.percent;
    } catch {
      // ignore — resuming is a nicety, not essential
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
      setTimeout(() => goToChapterUrl(nextBtn.dataset.url), 900);
    },
    { rootMargin: "200px" }
  );
  autoNextObserver.observe(bottomSentinel);
}
