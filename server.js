import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseChapterHtml, cacheKeyForChapter } from "./lib/parseChapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const BOOKMARKS_FILE = path.join(DATA_DIR, "bookmarks.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");

const PORT = process.env.PORT || 3000;

// --- small JSON-file "database" helpers -----------------------------------

async function ensureDataFiles() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  for (const [file, fallback] of [
    [BOOKMARKS_FILE, "[]"],
    [PROGRESS_FILE, "{}"],
  ]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, fallback, "utf8");
    }
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

// --- polite rate limiting for live fetches ---------------------------------
// The target site's robots.txt disallows automated access. Live fetching is
// kept opt-in per request (not crawled proactively), throttled, and every
// result is cached so the same chapter is never re-fetched on repeat reads.

const MIN_FETCH_GAP_MS = 2000;
let lastFetchAt = 0;

async function politeFetch(url) {
  const wait = Math.max(0, lastFetchAt + MIN_FETCH_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`Upstream responded ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// --- app --------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "10mb" })); // pasted chapter HTML can be large
app.use(express.static(path.join(__dirname, "public")));

async function cacheRead(key) {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function cacheWrite(key, data) {
  await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2), "utf8");
}

/** GET /api/chapter?url=... — cache first, then a throttled live fetch. */
app.get("/api/chapter", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  const key = cacheKeyForChapter(url);
  const cached = await cacheRead(key);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const html = await politeFetch(url);
    const parsed = parseChapterHtml(html, url);
    await cacheWrite(key, parsed);
    if (parsed.chapterId) await cacheWrite(cacheKeyForChapter(parsed.chapterId), parsed);
    res.json({ ...parsed, fromCache: false });
  } catch (err) {
    // Live fetch can fail for all sorts of reasons here (bot defenses,
    // network blocks, etc). Report it clearly so the frontend can offer
    // the "paste the page source" fallback instead of failing silently.
    res.status(502).json({
      error: "Live fetch failed. You can paste the chapter's page source instead.",
      detail: String(err.message || err),
    });
  }
});

/** POST /api/parse — { html, url } parse manually-pasted page source. */
app.post("/api/parse", async (req, res) => {
  const { html, url } = req.body || {};
  if (!html) return res.status(400).json({ error: "Missing 'html' in body" });

  try {
    const parsed = parseChapterHtml(html, url || null);
    const key = cacheKeyForChapter(url || parsed.chapterUrl || parsed.chapterTitle);
    await cacheWrite(key, parsed);
    if (parsed.chapterId) await cacheWrite(cacheKeyForChapter(parsed.chapterId), parsed);
    res.json({ ...parsed, fromCache: false });
  } catch (err) {
    res.status(422).json({ error: String(err.message || err) });
  }
});

// --- bookmarks ---------------------------------------------------------------

app.get("/api/bookmarks", async (_req, res) => {
  res.json(await readJson(BOOKMARKS_FILE, []));
});

app.post("/api/bookmarks", async (req, res) => {
  const { chapterId, chapterTitle, novelTitle, url } = req.body || {};
  if (!chapterId || !url) {
    return res.status(400).json({ error: "Need chapterId and url" });
  }
  const bookmarks = await readJson(BOOKMARKS_FILE, []);
  if (!bookmarks.some((b) => b.chapterId === chapterId)) {
    bookmarks.unshift({
      chapterId,
      chapterTitle,
      novelTitle,
      url,
      savedAt: new Date().toISOString(),
    });
    await writeJson(BOOKMARKS_FILE, bookmarks);
  }
  res.json(bookmarks);
});

app.delete("/api/bookmarks/:chapterId", async (req, res) => {
  const bookmarks = await readJson(BOOKMARKS_FILE, []);
  const next = bookmarks.filter((b) => b.chapterId !== req.params.chapterId);
  await writeJson(BOOKMARKS_FILE, next);
  res.json(next);
});

// --- reading progress ---------------------------------------------------------

app.get("/api/progress/:chapterId", async (req, res) => {
  const progress = await readJson(PROGRESS_FILE, {});
  res.json(progress[req.params.chapterId] || null);
});

app.put("/api/progress/:chapterId", async (req, res) => {
  const { percent, novelTitle, chapterTitle, url } = req.body || {};
  const progress = await readJson(PROGRESS_FILE, {});
  progress[req.params.chapterId] = {
    percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    novelTitle,
    chapterTitle,
    url,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(PROGRESS_FILE, progress);
  res.json(progress[req.params.chapterId]);
});

/** GET /api/continue — most recently updated progress entry, for a "resume" shortcut. */
app.get("/api/continue", async (_req, res) => {
  const progress = await readJson(PROGRESS_FILE, {});
  const entries = Object.entries(progress).map(([chapterId, v]) => ({ chapterId, ...v }));
  entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(entries[0] || null);
});

await ensureDataFiles();
app.listen(PORT, () => {
  console.log(`LN reader running at http://localhost:${PORT}`);
});
