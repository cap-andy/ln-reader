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
import { pool, query } from "./lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const NOVEL_CACHE_DIR = path.join(CACHE_DIR, "novels");
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "lnr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function ensureDataFiles() {
  await fs.mkdir(NOVEL_CACHE_DIR, { recursive: true });
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
    // TODO: look up the session by token, then the user it belongs to.
    // Hint: you can do this as one query with a JOIN on sessions.user_id = users.id,
    // filtering sessions.token = $1 and sessions.created_at > now() - interval '30 days'
    // (that replaces the old SESSION_TTL_MS check).
    // Set req.user = { id: ..., username: ... } if found.
    const session = await query(
      "SELECT users.id, users.username FROM sessions JOIN users on sessions.user_id = users.id WHERE token = $1 and sessions.created_at > now() - interval '30 days';",
      [token]
    );
    if (session.rows[0]){
      req.user = { id: session.rows[0].id, username: session.rows[0].username };
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
  await query(
    "INSERT INTO sessions (token, user_id) VALUES ($1, $2);",
    [token, userId]
  );
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
  let user;
  const { username, password } = req.body || {};
  const usernameErr = validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const passwordErr = validatePassword(password);
  if (passwordErr) return res.status(400).json({ error: passwordErr });

  const userExist = await query(
    "SELECT username FROM users WHERE LOWER(username) = LOWER($1);",
    [username]
  );
  if (userExist.rows[0]){
    res.status(409).json({ error: "That username is already taken." });
    return;
  } else {
    const passwordHash = await hashPassword(password);
    const result = await query(
      "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username;",
      [newUserId(), username, passwordHash]
    );
    user = result.rows[0];
  }
  await setSessionCookie(res, user.id);
  res.json({ id: user.id, username: user.username })
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const result = await query(
    "SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)",
    [username]
  );
  if (!result.rows[0]) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  const user = result.rows[0];
  if (!await verifyPassword(password, user.password_hash)){
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
  await setSessionCookie(res, user.id);
  res.json({ id: user.id, username: user.username })
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await query(
      "DELETE FROM sessions WHERE token = $1",
      [token]
    );
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

/** GET /api/novels — every novel added by any user (lightweight, for the homepage grid). */
app.get("/api/novels", async (_req, res) => {
  const result = await query(
    `SELECT
      id,
      novel_url AS "novelUrl",
      title,
      description,
      cover_url AS "coverUrl",
      author,
      status,
      first_chapter_url AS "firstChapterUrl",
      latest_chapter_name AS "latestChapterName",
      latest_chapter_url AS "latestChapterUrl",
      added_by AS "addedBy",
      created_at AS "createdAt"
    FROM novels
    ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

/** Fetches one novel with its genres and chapters attached, or null if it doesn't exist. */
async function getFullNovel(novelId) {
  const novelRowResult = await query (
    `SELECT
      id,
      novel_url AS "novelUrl",
      title,
      description,
      cover_url AS "coverUrl",
      author,
      status,
      first_chapter_url AS "firstChapterUrl",
      latest_chapter_name AS "latestChapterName",
      latest_chapter_url AS "latestChapterUrl",
      added_by AS "addedBy",
      created_at AS "createdAt"
    FROM novels
    WHERE id = $1`,
    [novelId]
  );
  const novelRow = novelRowResult.rows[0]
  if (!novelRow) return null;

  const genresResult = await query (
    "SELECT genre FROM novel_genres WHERE novel_id = $1",
    [novelId]
  );
  const genres = genresResult.rows.map(row => row.genre);

  const chaptersResult = await query (
    "SELECT chapter_id, title, url FROM novel_chapters WHERE novel_id = $1 ORDER BY position",
    [novelId]
  );
  const chapters = chaptersResult.rows.map((row) => ({ id: row.chapter_id, title: row.title, url: row.url }));

  return{...novelRow, genres, chapters};
}  
/** GET /api/novels/:id — full detail, including its chapter list. */
app.get("/api/novels/:id", async (req, res) => {
  const novel = await getFullNovel(req.params.id);
  if (!novel) return res.status(404).json({ error: "Novel not found." });
  res.json(novel);
});

/** DELETE /api/novels/:id — only the user who added it can remove it. */
app.delete("/api/novels/:id", requireAuth, async (req, res) => {
  const novelId = req.params.id;

  const result = await query(
    "SELECT * FROM novels WHERE id = $1",
    [novelId]
  );
  const novel = result.rows[0];
  if (!novel){
    res.status(404).json({ error: "Novel not found." });
    return;
  } 
  else if (novel.added_by !== req.user.id) {
    res.status(403).json({ error: "Only the person who added this novel can delete it." });
    return;
  }
  else{
    await query(
    "DELETE FROM novels WHERE id = $1",
    [novelId]
    );
  }

  // Best-effort cleanup — never block the delete response on these.
  await fs.unlink(path.join(NOVEL_CACHE_DIR, `${novelId}.json`)).catch(() => {});

  res.json({ ok: true });
});

async function insertFullNovel(parsed, userId) {
  const client = await pool.connect(); // grab one dedicated connection
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO novels (id, novel_url, title, description, description_html, cover_url, author, status, first_chapter_url, latest_chapter_name, latest_chapter_url, added_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [parsed.novelId, parsed.novelUrl, parsed.title, parsed.description, parsed.descriptionHtml, parsed.coverUrl, parsed.author, parsed.status, parsed.firstChapterUrl, parsed.latestChapterName, parsed.latestChapterUrl, userId]
    );

    for (const genre of parsed.genres) {
      await client.query(
        "INSERT INTO novel_genres (novel_id, genre) VALUES ($1, $2)",
        [parsed.novelId, genre]
      );
    }

    for (let i = 0; i < parsed.chapters.length; i++) {
      const chapter = parsed.chapters[i];
      await client.query(
        `INSERT INTO novel_chapters(novel_id, chapter_id, title, url, position)
        VALUES ($1, $2, $3, $4, $5)`,
        [parsed.novelId, chapter.id, chapter.title, chapter.url, i + 1]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK"); // undo everything since BEGIN
    throw err; // let the caller know it failed
  } finally {
    client.release(); // always give the connection back to the pool
  }
}

/** POST /api/novels/fetch — { url } live-fetch a NovelPing book page and add it. */
app.post("/api/novels/fetch", requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url." });

  try {
    const html = await politeFetch(url);
    const parsed = parseNovelHtml(html, url);
    await novelCacheWrite(parsed.novelId, parsed);
    const existing = await getFullNovel(parsed.novelId);
    let novel; 
    let created;
    if (existing){
      novel = existing;
      created = false;
    } else{
      await insertFullNovel(parsed, req.user.id);
      novel = await getFullNovel(parsed.novelId);
      created = true;
    }
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

    const existing = await getFullNovel(parsed.novelId);
    let novel;
    let created;
    if (existing) {
      novel = existing;
      created = false;
    } else {
      await insertFullNovel(parsed, req.user.id);
      novel = await getFullNovel(parsed.novelId);
      created = true;
    }
    res.json({ ...novel, created });
  } catch (err) {
    res.status(422).json({ error: String(err.message || err) });
  }
});

// --- bookmarks (per-user) ----------------------------------------------------
async function listBookmarksForUser(userId) {
  const result = await query (
    `SELECT id,
    novel_id AS "novelId",
    chapter_id AS "chapterId",
    chapter_title AS "chapterTitle",
    url,
    saved_at AS "savedAt",
    novel_title AS "novelTitle"
    FROM bookmarks 
    WHERE user_id = $1 
    ORDER BY saved_at DESC`,
    [userId]
  );
  return result.rows;
}

app.get("/api/bookmarks", requireAuth, async (req, res) => {
  const bookmarks = await listBookmarksForUser(req.user.id);
  res.json(bookmarks);
});

app.post("/api/bookmarks", requireAuth, async (req, res) => {
  const { chapterId, chapterTitle, novelTitle, novelId, url } = req.body || {};
  if (!chapterId || !url) {
    return res.status(400).json({ error: "Need chapterId and url" });
  }
  await query(
    `INSERT INTO bookmarks(user_id, chapter_id, chapter_title, novel_title, novel_id, url)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(user_id, chapter_id)
    DO NOTHING`,
    [req.user.id, chapterId, chapterTitle, novelTitle, novelId, url]
  );
  const bookmarks = await listBookmarksForUser(req.user.id);
  res.json(bookmarks);
});

app.delete("/api/bookmarks/:chapterId", requireAuth, async (req, res) => {
  await query(`DELETE FROM bookmarks 
    WHERE user_id = $1 AND chapter_id = $2;`,
    [req.user.id, req.params.chapterId]
  );
  
  const bookmarks = await listBookmarksForUser(req.user.id);
  res.json(bookmarks); 
});

// --- reading progress (per-user, per-novel) ----------------------------------
// Every novel keeps its own independent progress for every user, so you
// can be partway through several novels at once without them colliding.

app.get("/api/progress", requireAuth, async (req, res) => {
  const result = await query(
    "SELECT * FROM progress WHERE user_id = $1",
    [req.user.id]
  );
  const progress = {};
  for (const row of result.rows) {
    progress[row.novel_id] = {
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      chapterUrl: row.chapter_url,
      novelTitle: row.novel_title,
      percent: row.percent,
      updatedAt: row.updated_at,
    };
  }
  res.json(progress);
});

app.get("/api/progress/:novelId", requireAuth, async (req, res) => {
  const result = await query(
    "SELECT * FROM progress WHERE user_id = $1 AND novel_id = $2",
    [req.user.id, req.params.novelId]
  );

  if (!result.rows[0]) {
    return res.json(null);
  };

  const row = result.rows[0];
   const progress ={
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterUrl: row.chapter_url,
    novelTitle: row.novel_title,
    percent: row.percent,
    updatedAt: row.updated_at,
  }
  res.json(progress);  
});

app.put("/api/progress/:novelId", requireAuth, async (req, res) => {
  const { chapterId, chapterTitle, chapterUrl, novelTitle, percent } = req.body || {};
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  // TODO: save this as the user's progress for this novel.
  const result = await query(
    `INSERT INTO progress (user_id, novel_id, chapter_id, chapter_title, chapter_url, novel_title, percent)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, novel_id)
    DO UPDATE SET
      chapter_id = EXCLUDED.chapter_id,
      chapter_title = EXCLUDED.chapter_title,
      chapter_url = EXCLUDED.chapter_url,
      novel_title = EXCLUDED.novel_title,
      percent = EXCLUDED.percent,
      updated_at = now()
    RETURNING *;`,
    [req.user.id, req.params.novelId, chapterId, chapterTitle, chapterUrl, novelTitle, safePercent]
  );
  const row = result.rows[0];
   const progress ={
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterUrl: row.chapter_url,
    novelTitle: row.novel_title,
    percent: row.percent,
    updatedAt: row.updated_at,
  }
  res.json(progress); 
});

/** GET /api/continue — this user's most recently updated novel, for a "resume" shortcut. */
app.get("/api/continue", requireAuth, async (req, res) => {
  const result = await query(
    `SELECT * FROM progress WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [req.user.id]
  );
  if (!result.rows[0]) {
    return res.json(null);
  }
  const row = result.rows[0];
  const progress ={
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterUrl: row.chapter_url,
    novelTitle: row.novel_title,
    percent: row.percent,
    updatedAt: row.updated_at,
    novelId: row.novel_id,
  }
  res.json(progress); 
});

await ensureDataFiles();
app.listen(PORT, () => {
  console.log(`LN reader running at http://localhost:${PORT}`);
});
