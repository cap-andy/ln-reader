import { api } from "../api.js";
import { state } from "../state.js";
import { navigate } from "../router.js";
import { showStatus, clearStatus, setTopbarTitle, showView } from "../ui.js";
import { mountReaderView } from "./reader.js";

const el = (id) => document.getElementById(id);

const novelCover = el("novelCover");
const novelDetailTitle = el("novelDetailTitle");
const novelMeta = el("novelMeta");
const novelDescription = el("novelDescription");
const continueReadingBtn = el("continueReadingBtn");
const startReadingBtn = el("startReadingBtn");
const deleteNovelBtn = el("deleteNovelBtn");
const novelChapterList = el("novelChapterList");

const novelFetchWrap = el("novelFetchWrap");
const novelFetchToggleBtn = el("novelFetchToggleBtn");
const novelFetchBar = el("novelFetchBar");
const novelUrlInput = el("novelUrlInput");
const novelFetchBtn = el("novelFetchBtn");
const novelPasteModeBtn = el("novelPasteModeBtn");
const novelPasteBar = el("novelPasteBar");
const novelPasteArea = el("novelPasteArea");
const novelParsePasteBtn = el("novelParsePasteBtn");
const novelCancelPasteBtn = el("novelCancelPasteBtn");

let currentNovel = null;

function openNovelFetchBar() {
  novelFetchBar.classList.add("open");
  novelUrlInput.focus();
}
function closeNovelFetchBar() {
  novelFetchBar.classList.remove("open");
}
novelFetchToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (novelFetchBar.classList.contains("open")) closeNovelFetchBar();
  else openNovelFetchBar();
});
document.addEventListener("click", (e) => {
  if (novelFetchBar.classList.contains("open") && !novelFetchWrap.contains(e.target)) closeNovelFetchBar();
});

function placeholderCover(title) {
  const letter = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="300">
    <rect width="100%" height="100%" fill="#8a8373"/>
    <text x="50%" y="52%" font-family="sans-serif" font-size="88" fill="#f5f1e8" text-anchor="middle" dominant-baseline="middle">${letter}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export async function mountNovelView({ params }) {
  const novelId = params.id;
  showView("view-novel");
  closeNovelFetchBar();
  novelPasteBar.classList.add("hidden");
  setTopbarTitle("");
  novelChapterList.innerHTML = "";
  novelDetailTitle.textContent = "Loading…";
  novelMeta.textContent = "";
  novelDescription.textContent = "";
  continueReadingBtn.classList.add("hidden");
  startReadingBtn.classList.add("hidden");
  deleteNovelBtn.classList.add("hidden");

  let novel;
  try {
    novel = await api.getNovel(novelId);
  } catch (err) {
    novelDetailTitle.textContent = "Novel not found";
    novelDescription.textContent = err.message || "Could not load this novel.";
    return;
  }
  currentNovel = novel;

  novelCover.src = novel.coverUrl || placeholderCover(novel.title);
  novelCover.alt = novel.title || "";
  novelCover.addEventListener("error", () => (novelCover.src = placeholderCover(novel.title)), { once: true });

  novelDetailTitle.textContent = novel.title || "Untitled novel";
  setTopbarTitle(novel.title || "");

  const metaBits = [];
  if (novel.author) metaBits.push(`by ${novel.author}`);
  if (novel.genres?.length) metaBits.push(novel.genres.join(", "));
  if (novel.status) metaBits.push(novel.status);
  if (novel.addedByUsername) metaBits.push(`added by ${novel.addedByUsername}`);
  novelMeta.textContent = metaBits.join(" · ");

  novelDescription.textContent = novel.description || "";

  renderChapterList(novel);

  // Continue / start reading, using this user's own progress for this novel.
  let progress = null;
  if (state.user) {
    try {
      progress = await api.getProgress(novelId);
    } catch {
      // not essential
    }
  }
  if (progress?.chapterUrl) {
    continueReadingBtn.textContent = progress.chapterTitle
      ? `Continue: ${progress.chapterTitle}`
      : "Continue reading";
    continueReadingBtn.classList.remove("hidden");
    continueReadingBtn.onclick = () => goToChapter(progress.chapterUrl);
  }
  if (novel.firstChapterUrl) {
    startReadingBtn.textContent = progress?.chapterUrl ? "Start from Chapter 1" : "Start reading";
    startReadingBtn.classList.remove("hidden");
    startReadingBtn.onclick = () => goToChapter(novel.firstChapterUrl);
  }

  if (state.user && novel.addedBy === state.user.id) {
    deleteNovelBtn.classList.remove("hidden");
  }

  highlightCurrentChapter(progress?.chapterId);
}

async function deleteCurrentNovel() {
  if (!currentNovel) return;
  const confirmed = window.confirm(
    `Delete "${currentNovel.title}"? This removes it for everyone, along with everyone's reading progress and bookmarks for it. This can't be undone.`
  );
  if (!confirmed) return;

  deleteNovelBtn.disabled = true;
  try {
    await api.deleteNovel(currentNovel.id);
    navigate("/");
  } catch (err) {
    showStatus(err.message || "Could not delete this novel.", true);
    deleteNovelBtn.disabled = false;
  }
}

deleteNovelBtn.addEventListener("click", deleteCurrentNovel);

function renderChapterList(novel) {
  novelChapterList.innerHTML = "";
  if (!novel.chapters || novel.chapters.length === 0) {
    const li = document.createElement("li");
    li.className = "chapter-list-empty";
    li.textContent = novel.firstChapterUrl
      ? "No chapter list available — use \u201cStart reading\u201d or the Fetch chapter bar above."
      : "No chapters found for this novel yet.";
    novelChapterList.appendChild(li);
    return;
  }
  for (const chapter of novel.chapters) {
    const li = document.createElement("li");
    li.className = "chapter-list-item";
    li.dataset.chapterId = chapter.id;
    li.textContent = chapter.title;
    li.addEventListener("click", () => goToChapter(chapter.url));
    novelChapterList.appendChild(li);
  }
}

function highlightCurrentChapter(chapterId) {
  novelChapterList.querySelectorAll(".chapter-list-item").forEach((li) => {
    li.classList.toggle("current", Boolean(chapterId) && li.dataset.chapterId === chapterId);
  });
}

function goToChapter(url) {
  navigate(`/novel/${encodeURIComponent(currentNovel.id)}/read`, { url });
}

async function fetchChapterByUrl() {
  const url = novelUrlInput.value.trim();
  if (!url) return;
  clearStatus();
  showStatus("Fetching chapter…");
  try {
    await api.fetchChapter(url); // warms the cache / validates it parses; reader re-fetches (cache hit)
    clearStatus();
    closeNovelFetchBar();
    novelUrlInput.value = "";
    goToChapter(url);
  } catch (err) {
    showStatus(err.message || "Fetch failed. Try pasting the page source instead.", true);
    novelPasteBar.classList.remove("hidden");
  }
}

async function fetchChapterByPastedHtml() {
  const html = novelPasteArea.value.trim();
  if (!html) return showStatus("Paste the page source first.", true);
  clearStatus();
  showStatus("Parsing pasted HTML…");
  try {
    const data = await api.parseChapterHtml(html, novelUrlInput.value.trim() || null);
    novelPasteBar.classList.add("hidden");
    novelPasteArea.value = "";
    novelUrlInput.value = "";
    closeNovelFetchBar();
    clearStatus();
    if (data.chapterUrl) {
      goToChapter(data.chapterUrl);
    } else {
      // No usable URL to route by (route params must be re-fetchable) —
      // render what we already parsed directly instead.
      mountReaderView({ novelId: currentNovel.id, novelTitle: currentNovel.title, chapterData: data });
    }
  } catch (err) {
    showStatus(err.message || "Could not parse that HTML.", true);
  }
}

novelFetchBtn.addEventListener("click", fetchChapterByUrl);
novelUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchChapterByUrl();
});
novelPasteModeBtn.addEventListener("click", () => novelPasteBar.classList.toggle("hidden"));
novelCancelPasteBtn.addEventListener("click", () => novelPasteBar.classList.add("hidden"));
novelParsePasteBtn.addEventListener("click", fetchChapterByPastedHtml);
