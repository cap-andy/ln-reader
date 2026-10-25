import { api } from "./api.js";
import { state, settings, saveSettings, onUserChange } from "./state.js";
import { route, notFound, navigate, startRouter } from "./router.js";
import { showStatus, clearStatus, setTopbarTitle, showView, closeAllPanels } from "./ui.js";
import { initAuth, showAuthView, mountAuthView } from "./views/auth.js";
import { mountHomeView } from "./views/home.js";
import { mountNovelView } from "./views/novel.js";
import { mountReaderView, getCurrentChapter } from "./views/reader.js";

const el = (id) => document.getElementById(id);

const topbar = el("topbar");
const reader = el("reader");

const bookmarkCurrentBtn = el("bookmarkCurrentBtn");
const bookmarksToggle = el("bookmarksToggle");
const bookmarksPanel = el("bookmarksPanel");
const bookmarksList = el("bookmarksList");

const settingsToggle = el("settingsToggle");
const settingsPanel = el("settingsPanel");
const settingsCloseBtn = el("settingsCloseBtn");
const bookmarksCloseBtn = el("bookmarksCloseBtn");
const themeToggle = el("themeToggle");

const fontDown = el("fontDown");
const fontUp = el("fontUp");
const fontSizeLabel = el("fontSizeLabel");
const lineDown = el("lineDown");
const lineUp = el("lineUp");
const lineHeightLabel = el("lineHeightLabel");
const fontFamilySelect = el("fontFamilySelect");
const autoNextToggle = el("autoNextToggle");
const chapterContentEl = el("chapterContent");

// ---------------------------------------------------------------------------
// Settings (font size / line height / font family / dark mode / auto-next)
// ---------------------------------------------------------------------------

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

applySettings();

// ---------------------------------------------------------------------------
// Settings / bookmarks panel toggling
// ---------------------------------------------------------------------------

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  bookmarksPanel.classList.add("hidden");
});
bookmarksToggle.addEventListener("click", () => {
  bookmarksPanel.classList.toggle("hidden");
  settingsPanel.classList.add("hidden");
  if (!bookmarksPanel.classList.contains("hidden")) loadBookmarks();
});
settingsCloseBtn.addEventListener("click", () => settingsPanel.classList.add("hidden"));
bookmarksCloseBtn.addEventListener("click", () => bookmarksPanel.classList.add("hidden"));

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

// ---------------------------------------------------------------------------
// Bookmarks (per logged-in user)
// ---------------------------------------------------------------------------

bookmarkCurrentBtn.addEventListener("click", async () => {
  const current = getCurrentChapter();
  if (!current?.chapterId) return;
  if (!state.user) return navigate("/login", { redirect: location.hash.slice(1) || "/" });
  await api.addBookmark({
    chapterId: current.chapterId,
    chapterTitle: current.chapterTitle,
    novelTitle: current.novelTitle,
    novelId: current.novelId,
    url: current.chapterUrl,
  });
  bookmarkCurrentBtn.textContent = "★ Saved";
  setTimeout(() => (bookmarkCurrentBtn.textContent = "★ Bookmark this chapter"), 1200);
  if (!bookmarksPanel.classList.contains("hidden")) loadBookmarks();
});

async function loadBookmarks() {
  bookmarksList.innerHTML = "";
  if (!state.user) {
    bookmarksList.innerHTML = `<li style="cursor:default">Log in to save bookmarks.</li>`;
    return;
  }
  const bookmarks = await api.listBookmarks();
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
      bookmarksPanel.classList.add("hidden");
      if (b.novelId) {
        navigate(`/novel/${encodeURIComponent(b.novelId)}/read`, { url: b.url });
      } else {
        // Bookmark predates per-novel routing (shouldn't normally happen) —
        // fall back to fetching it standalone isn't supported by the router,
        // so just open the source page instead.
        window.open(b.url, "_blank", "noopener");
      }
    });
    bookmarksList.appendChild(li);
  }
  bookmarksList.querySelectorAll(".bm-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api.removeBookmark(btn.dataset.id);
      loadBookmarks();
    });
  });
}

// ---------------------------------------------------------------------------
// Auto-hide top bar once the reader article has scrolled up beneath it
// ---------------------------------------------------------------------------

let lastScrollY = window.scrollY;
let topbarHeight = topbar.offsetHeight;
let scrollTicking = false;

window.addEventListener("resize", () => (topbarHeight = topbar.offsetHeight));

function handleTopbarScroll() {
  const currentY = window.scrollY;
  const delta = currentY - lastScrollY;
  const pastThreshold = currentY > topbarHeight;
  const inReaderView = !reader.closest(".view").classList.contains("hidden");

  if (inReaderView && pastThreshold) {
    if (delta > 2) topbar.classList.add("topbar-hidden");
    else if (delta < -2) topbar.classList.remove("topbar-hidden");
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

function resetTopbarOnNavigate() {
  lastScrollY = 0;
  topbar.classList.remove("topbar-hidden");
}

// ---------------------------------------------------------------------------
// React to login/logout: refresh whatever's currently showing that depends
// on the user (bookmark button state, an open bookmarks panel, the novel
// page's continue/add-novel affordances).
// ---------------------------------------------------------------------------

onUserChange(() => {
  const current = getCurrentChapter();
  bookmarkCurrentBtn.disabled = !current?.chapterId || !state.user;
  if (!bookmarksPanel.classList.contains("hidden")) loadBookmarks();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

route("/", async () => {
  closeAllPanels();
  resetTopbarOnNavigate();
  await mountHomeView();
});

route("/novel/:id", async ({ params }) => {
  closeAllPanels();
  resetTopbarOnNavigate();
  await mountNovelView({ params });
});

route("/novel/:id/read", async ({ params, query }) => {
  closeAllPanels();
  resetTopbarOnNavigate();
  await mountReaderView({ novelId: params.id, chapterUrl: query.url });
});

route("/login", ({ query }) => {
  closeAllPanels();
  resetTopbarOnNavigate();
  showView("view-auth");
  setTopbarTitle("Log in");
  showAuthView({ mode: "login", redirect: query.redirect });
  mountAuthView();
});

route("/register", ({ query }) => {
  closeAllPanels();
  resetTopbarOnNavigate();
  showView("view-auth");
  setTopbarTitle("Register");
  showAuthView({ mode: "register", redirect: query.redirect });
  mountAuthView();
});

notFound(() => navigate("/"));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async function init() {
  await initAuth();
  startRouter();
})();
