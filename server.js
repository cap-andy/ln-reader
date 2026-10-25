import express from "express";
import cookieParser from "cookie-parser";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseChapterHtml, cacheKeyForChapter } from "./lib/parseChapter.js";
import { parseNovelHtml } from "./lib/parseNovel.js";
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  newUserId,
  validateUsername,
  validatePassword,
} from "./lib/auth.js";
import { readJson, writeJson, withFileLock } from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const NOVEL_CACHE_DIR = path.join(CACHE_DIR, "novels");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const NOVELS_FILE = path.join(DATA_DIR, "novels.json");
const BOOKMARKS_FILE = path.join(DATA_DIR, "bookmarks.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");

const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "lnr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// --- one-time migration from the pre-login data format ---------------------
// bookmarks.json used to be a flat array; progress.json used to be keyed
// directly by chapterId. Both are now per-user. Rather than guess at a
// mapping (there's no userId or reliable novelId on the old entries), the
// old files are backed up untouched and the app starts fresh — you can
// still open the .bak files by hand if you want to recover anything.
async function migrateLegacyDataIfNeeded() {
  try {
    const raw = await fs.readFile(BOOKMARKS_FILE, "utf8");
    if (Array.isArray(JSON.parse(raw))) {
      await fs.rename(BOOKMARKS_FILE, path.join(DATA_DIR, "bookmarks.pre-auth.json.bak"));
      console.log(
        "[migrate] bookmarks.json was in the old (pre-login) format — backed up to data/bookmarks.pre-auth.json.bak"
      );
    }
  } catch {
    // missing or unreadable — fine, ensureDataFiles() will create a fresh one
  }

  try {
    const raw = await fs.readFile(PROGRESS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const looksLegacy = Object.values(parsed).some((v) => v && typeof v === "object" && "percent" in v);
    if (looksLegacy) {
      await fs.rename(PROGRESS_FILE, path.join(DATA_DIR, "progress.pre-auth.json.bak"));
      console.log(
        "[migrate] progress.json was in the old (pre-login) format — backed up to data/progress.pre-auth.json.bak"
      );
    }
  } catch {
    // missing or unreadable — fine
  }
}

async function ensureDataFiles() {
  await fs.mkdir(NOVEL_CACHE_DIR, { recursive: true });
  for (const [file, fallback] of [
    [USERS_FILE, "[]"],
    [SESSIONS_FILE, "{}"],
    [NOVELS_FILE, "[]"],
    [BOOKMARKS_FILE, "{}"],
    [PROGRESS_FILE, "{}"],
  ]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, fallback, "utf8");
    }
  }
}

// --- polite rate limiting for live fetches ---------------------------------
// The target site's robots.txt disallows automated access to chapter AND
// novel pages. Live fetching (of either) is kept strictly opt-in per
// request — a person explicitly fetching the one chapter they're reading,
// or the one novel they're adding — never a crawl, never scheduled, never
// bulk. Every result is cached so the same page is never re-fetched.

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
app.use(express.json({ limit: "10mb" })); // pasted page HTML can be large
app.use(cookieParser());

// --- auth: cookie session -> req.user ---------------------------------------

async function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const sessions = await readJson(SESSIONS_FILE, {});
    const session = sessions[token];
    if (session && Date.now() - session.createdAt < SESSION_TTL_MS) {
      const users = await readJson(USERS_FILE, []);
      const user = users.find((u) => u.id === session.userId);
      if (user) req.user = { id: user.id, username: user.username };
    }
  }
  next();
}
app.use(attachUser);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please log in first." });
  next();
}

async function setSessionCookie(res, userId) {
  const token = newSessionToken();
  await withFileLock(SESSIONS_FILE, async () => {
    const sessions = await readJson(SESSIONS_FILE, {});
    sessions[token] = { userId, createdAt: Date.now() };
    await writeJson(SESSIONS_FILE, sessions);
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

app.use(express.static(path.join(__dirname, "public")));

// --- auth routes -------------------------------------------------------------

app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body || {};
  const usernameErr = validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const passwordErr = validatePassword(password);
  if (passwordErr) return res.status(400).json({ error: passwordErr });

  const result = await withFileLock(USERS_FILE, async () => {
    const users = await readJson(USERS_FILE, []);
    const taken = users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase());
    if (taken) return { error: "That username is already taken.", status: 409 };

    const user = {
      id: newUserId(),
      username: username.trim(),
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await writeJson(USERS_FILE, users);
    return { user };
  });

  if (result.error) return res.status(result.status).json({ error: result.error });
  await setSessionCookie(res, result.user.id);
  res.json({ id: result.user.id, username: result.user.username });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const users = await readJson(USERS_FILE, []);
  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  await setSessionCookie(res, user.id);
  res.json({ id: user.id, username: user.username });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await withFileLock(SESSIONS_FILE, async () => {
      const sessions = await readJson(SESSIONS_FILE, {});
      delete sessions[token];
      await writeJson(SESSIONS_FILE, sessions);
    });
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json(req.user || null);
});

// --- chapter cache -----------------------------------------------------------

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
    res.status(502).json({
      error: "Live fetch failed. You can paste the chapter's page source instead.",
      detail: String(err.message || err),
    });
  }
});

/** POST /api/parse — { html, url } parse manually-pasted chapter page source. */
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

// --- novels (global: visible to every user, addable by any logged-in user) -

async function novelCacheWrite(novelId, data) {
  await fs.writeFile(path.join(NOVEL_CACHE_DIR, `${novelId}.json`), JSON.stringify(data, null, 2), "utf8");
}

function toNovelRecord(parsed, user) {
  return {
    id: parsed.novelId,
    novelUrl: parsed.novelUrl,
    title: parsed.title,
    description: parsed.description,
    descriptionHtml: parsed.descriptionHtml,
    coverUrl: parsed.coverUrl,
    author: parsed.author,
    genres: parsed.genres,
    status: parsed.status,
    firstChapterUrl: parsed.firstChapterUrl,
    latestChapterName: parsed.latestChapterName,
    latestChapterUrl: parsed.latestChapterUrl,
    chapters: parsed.chapters,
    addedBy: user.id,
    addedByUsername: user.username,
    createdAt: new Date().toISOString(),
  };
}

/** Saves a newly-parsed novel unless one with the same id already exists globally. */
async function saveNovelFromParsed(parsed, user) {
  return withFileLock(NOVELS_FILE, async () => {
    const novels = await readJson(NOVELS_FILE, []);
    const existing = novels.find((n) => n.id === parsed.novelId);
    if (existing) return { novel: existing, created: false };
    const novel = toNovelRecord(parsed, user);
    novels.unshift(novel);
    await writeJson(NOVELS_FILE, novels);
    return { novel, created: true };
  });
}

/** GET /api/novels — every novel added by any user (lightweight, for the homepage grid). */
app.get("/api/novels", async (_req, res) => {
  const novels = await readJson(NOVELS_FILE, []);
  const list = novels.map(({ chapters, descriptionHtml, ...rest }) => rest);
  res.json(list);
});

/** GET /api/novels/:id — full detail, including its chapter list. */
app.get("/api/novels/:id", async (req, res) => {
  const novels = await readJson(NOVELS_FILE, []);
  const novel = novels.find((n) => n.id === req.params.id);
  if (!novel) return res.status(404).json({ error: "Novel not found." });
  res.json(novel);
});

/** DELETE /api/novels/:id — only the user who added it can remove it. */
app.delete("/api/novels/:id", requireAuth, async (req, res) => {
  const novelId = req.params.id;

  const result = await withFileLock(NOVELS_FILE, async () => {
    const novels = await readJson(NOVELS_FILE, []);
    const novel = novels.find((n) => n.id === novelId);
    if (!novel) return { error: "Novel not found.", status: 404 };
    if (novel.addedBy !== req.user.id) {
      return { error: "Only the person who added this novel can delete it.", status: 403 };
    }
    const next = novels.filter((n) => n.id !== novelId);
    await writeJson(NOVELS_FILE, next);
    return { ok: true };
  });

  if (result.error) return res.status(result.status).json({ error: result.error });

  // Best-effort cleanup — never block the delete response on these.
  await fs.unlink(path.join(NOVEL_CACHE_DIR, `${novelId}.json`)).catch(() => {});

  await withFileLock(PROGRESS_FILE, async () => {
    const all = await readJson(PROGRESS_FILE, {});
    for (const userId of Object.keys(all)) {
      if (all[userId] && novelId in all[userId]) delete all[userId][novelId];
    }
    await writeJson(PROGRESS_FILE, all);
  });

  await withFileLock(BOOKMARKS_FILE, async () => {
    const all = await readJson(BOOKMARKS_FILE, {});
    for (const userId of Object.keys(all)) {
      all[userId] = (all[userId] || []).filter((b) => b.novelId !== novelId);
    }
    await writeJson(BOOKMARKS_FILE, all);
  });

  res.json({ ok: true });
});

/** POST /api/novels/fetch — { url } live-fetch a NovelPing book page and add it. */
app.post("/api/novels/fetch", requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url." });

  try {
    const html = await politeFetch(url);
    const parsed = parseNovelHtml(html, url);
    await novelCacheWrite(parsed.novelId, parsed);
    const { novel, created } = await saveNovelFromParsed(parsed, req.user);
    res.json({ ...novel, created });
  } catch (err) {
    res.status(502).json({
      error: "Live fetch failed. You can paste the novel page source instead.",
      detail: String(err.message || err),
    });
  }
});

/** POST /api/novels/parse — { html, url } parse a manually-pasted novel page and add it. */
app.post("/api/novels/parse", requireAuth, async (req, res) => {
  const { html, url } = req.body || {};
  if (!html) return res.status(400).json({ error: "Missing 'html' in body" });

  try {
    const parsed = parseNovelHtml(html, url || null);
    await novelCacheWrite(parsed.novelId, parsed);
    const { novel, created } = await saveNovelFromParsed(parsed, req.user);
    res.json({ ...novel, created });
  } catch (err) {
    res.status(422).json({ error: String(err.message || err) });
  }
});

// --- bookmarks (per-user) ----------------------------------------------------

app.get("/api/bookmarks", requireAuth, async (req, res) => {
  const all = await readJson(BOOKMARKS_FILE, {});
  res.json(all[req.user.id] || []);
});

app.post("/api/bookmarks", requireAuth, async (req, res) => {
  const { chapterId, chapterTitle, novelTitle, novelId, url } = req.body || {};
  if (!chapterId || !url) {
    return res.status(400).json({ error: "Need chapterId and url" });
  }
  const mine = await withFileLock(BOOKMARKS_FILE, async () => {
    const all = await readJson(BOOKMARKS_FILE, {});
    const list = all[req.user.id] || [];
    if (!list.some((b) => b.chapterId === chapterId)) {
      list.unshift({
        chapterId,
        chapterTitle,
        novelTitle,
        novelId: novelId || null,
        url,
        savedAt: new Date().toISOString(),
      });
    }
    all[req.user.id] = list;
    await writeJson(BOOKMARKS_FILE, all);
    return list;
  });
  res.json(mine);
});

app.delete("/api/bookmarks/:chapterId", requireAuth, async (req, res) => {
  const mine = await withFileLock(BOOKMARKS_FILE, async () => {
    const all = await readJson(BOOKMARKS_FILE, {});
    const list = (all[req.user.id] || []).filter((b) => b.chapterId !== req.params.chapterId);
    all[req.user.id] = list;
    await writeJson(BOOKMARKS_FILE, all);
    return list;
  });
  res.json(mine);
});

// --- reading progress (per-user, per-novel) ----------------------------------
// Every novel keeps its own independent progress for every user, so you
// can be partway through several novels at once without them colliding.

app.get("/api/progress", requireAuth, async (req, res) => {
  const all = await readJson(PROGRESS_FILE, {});
  res.json(all[req.user.id] || {});
});

app.get("/api/progress/:novelId", requireAuth, async (req, res) => {
  const all = await readJson(PROGRESS_FILE, {});
  res.json(all[req.user.id]?.[req.params.novelId] || null);
});

app.put("/api/progress/:novelId", requireAuth, async (req, res) => {
  const { chapterId, chapterTitle, chapterUrl, novelTitle, percent } = req.body || {};
  const entry = {
    chapterId: chapterId || null,
    chapterTitle: chapterTitle || null,
    chapterUrl: chapterUrl || null,
    novelTitle: novelTitle || null,
    percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    updatedAt: new Date().toISOString(),
  };
  await withFileLock(PROGRESS_FILE, async () => {
    const all = await readJson(PROGRESS_FILE, {});
    all[req.user.id] = all[req.user.id] || {};
    all[req.user.id][req.params.novelId] = entry;
    await writeJson(PROGRESS_FILE, all);
  });
  res.json(entry);
});

/** GET /api/continue — this user's most recently updated novel, for a "resume" shortcut. */
app.get("/api/continue", requireAuth, async (req, res) => {
  const all = await readJson(PROGRESS_FILE, {});
  const mine = all[req.user.id] || {};
  const entries = Object.entries(mine).map(([novelId, v]) => ({ novelId, ...v }));
  entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(entries[0] || null);
});

await migrateLegacyDataIfNeeded();
await ensureDataFiles();
app.listen(PORT, () => {
  console.log(`LN reader running at http://localhost:${PORT}`);
});
