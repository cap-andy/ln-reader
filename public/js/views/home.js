import { api } from "../api.js";
import { state } from "../state.js";
import { navigate } from "../router.js";
import { showStatus, clearStatus, setTopbarTitle, showView } from "../ui.js";

const el = (id) => document.getElementById(id);

const novelGrid = el("novelGrid");
const homeEmptyState = el("homeEmptyState");

const resumeBar = el("resumeBar");
const resumeBarTitle = el("resumeBarTitle");
const resumeReadingBtn = el("resumeReadingBtn");

const addNovelWrap = el("addNovelWrap");
const addNovelToggleBtn = el("addNovelToggleBtn");
const addNovelBar = el("addNovelBar");
const addNovelUrlInput = el("addNovelUrlInput");
const addNovelBtn = el("addNovelBtn");
const addNovelPasteModeBtn = el("addNovelPasteModeBtn");
const addNovelPasteBar = el("addNovelPasteBar");
const addNovelPasteArea = el("addNovelPasteArea");
const addNovelParsePasteBtn = el("addNovelParsePasteBtn");
const addNovelCancelPasteBtn = el("addNovelCancelPasteBtn");

function openAddNovelBar() {
  if (!state.user) {
    navigate("/login", { redirect: "/" });
    return;
  }
  addNovelBar.classList.add("open");
  addNovelUrlInput.focus();
}
function closeAddNovelBar() {
  addNovelBar.classList.remove("open");
}

addNovelToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (addNovelBar.classList.contains("open")) closeAddNovelBar();
  else openAddNovelBar();
});
document.addEventListener("click", (e) => {
  if (addNovelBar.classList.contains("open") && !addNovelWrap.contains(e.target)) closeAddNovelBar();
});

function placeholderCover(title) {
  // Simple inline SVG placeholder so a missing cover never leaves a broken-image icon.
  const letter = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="220">
    <rect width="100%" height="100%" fill="#8a8373"/>
    <text x="50%" y="52%" font-family="sans-serif" font-size="64" fill="#f5f1e8" text-anchor="middle" dominant-baseline="middle">${letter}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trim() + "…" : text;
}

function novelCard(novel, progress) {
  const card = document.createElement("article");
  card.className = "novel-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const cover = document.createElement("img");
  cover.className = "novel-card-cover";
  cover.loading = "lazy";
  cover.alt = novel.title || "";
  cover.src = novel.coverUrl || placeholderCover(novel.title);
  cover.addEventListener("error", () => {
    cover.src = placeholderCover(novel.title);
  });

  const body = document.createElement("div");
  body.className = "novel-card-body";

  const title = document.createElement("h3");
  title.className = "novel-card-title";
  title.textContent = novel.title || "Untitled novel";

  const meta = document.createElement("div");
  meta.className = "novel-card-meta";
  const metaBits = [novel.author, novel.status].filter(Boolean);
  meta.textContent = metaBits.join(" · ");

  const desc = document.createElement("p");
  desc.className = "novel-card-desc";
  desc.textContent = truncate(novel.description, 140);

  body.append(title, meta, desc);

  if (progress) {
    const badge = document.createElement("div");
    badge.className = "novel-card-progress";
    badge.textContent = progress.chapterTitle
      ? `Continue: ${progress.chapterTitle}`
      : "In progress";
    body.appendChild(badge);
  }

  card.append(cover, body);

  const go = () => navigate(`/novel/${encodeURIComponent(novel.id)}`);
  card.addEventListener("click", go);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  });

  return card;
}

export async function mountHomeView() {
  showView("view-home");
  setTopbarTitle("");
  closeAddNovelBar();
  await Promise.all([loadAndRenderNovels(), loadResumeBar()]);
}

async function loadResumeBar() {
  resumeBar.classList.add("hidden");
  if (!state.user) return;
  let last;
  try {
    last = await api.continueReading();
  } catch {
    return;
  }
  if (!last?.chapterUrl || !last?.novelId) return;

  resumeBarTitle.textContent = [last.novelTitle, last.chapterTitle].filter(Boolean).join(" — ");
  resumeReadingBtn.onclick = () => navigate(`/novel/${encodeURIComponent(last.novelId)}/read`, { url: last.chapterUrl });
  resumeBar.classList.remove("hidden");
}

async function loadAndRenderNovels() {
  novelGrid.innerHTML = "";
  let novels = [];
  let progressByNovelId = {};
  try {
    [novels, progressByNovelId] = await Promise.all([
      api.listNovels(),
      state.user ? api.getAllProgress().catch(() => ({})) : Promise.resolve({}),
    ]);
  } catch (err) {
    showStatus("Could not load novels: " + err.message, true);
    return;
  }

  homeEmptyState.classList.toggle("hidden", novels.length > 0);
  for (const novel of novels) {
    novelGrid.appendChild(novelCard(novel, progressByNovelId[novel.id]));
  }
}

async function addNovelByUrl() {
  const url = addNovelUrlInput.value.trim();
  if (!url) return;
  clearStatus();
  showStatus("Fetching novel…");
  try {
    const novel = await api.addNovelByUrl(url);
    clearStatus();
    closeAddNovelBar();
    addNovelUrlInput.value = "";
    navigate(`/novel/${encodeURIComponent(novel.id)}`);
  } catch (err) {
    showStatus(err.message || "Fetch failed. Try pasting the page source instead.", true);
    addNovelPasteBar.classList.remove("hidden");
  }
}

async function addNovelByPastedHtml() {
  const html = addNovelPasteArea.value.trim();
  if (!html) return showStatus("Paste the page source first.", true);
  clearStatus();
  showStatus("Parsing pasted HTML…");
  try {
    const novel = await api.addNovelByHtml(html, addNovelUrlInput.value.trim() || null);
    addNovelPasteBar.classList.add("hidden");
    addNovelPasteArea.value = "";
    addNovelUrlInput.value = "";
    closeAddNovelBar();
    clearStatus();
    navigate(`/novel/${encodeURIComponent(novel.id)}`);
  } catch (err) {
    showStatus(err.message || "Could not parse that HTML.", true);
  }
}

addNovelBtn.addEventListener("click", addNovelByUrl);
addNovelUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addNovelByUrl();
});
addNovelPasteModeBtn.addEventListener("click", () => addNovelPasteBar.classList.toggle("hidden"));
addNovelCancelPasteBtn.addEventListener("click", () => addNovelPasteBar.classList.add("hidden"));
addNovelParsePasteBtn.addEventListener("click", addNovelByPastedHtml);
