// One-off migration: read the existing data/*.json files and insert them
// into Postgres. Safe to re-run — every insert uses ON CONFLICT DO NOTHING.
import { readFile } from "fs/promises";
import { query, pool } from "../lib/db.js";

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function migrateUsers() {
  const users = await readJsonFile("data/users.json", []);
  let count = 0;
  for (const u of users) {
    await query(
      `INSERT INTO users (id, username, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.passwordHash, u.createdAt]
    );
    count++;
  }
  console.log(`users: ${count} read from JSON`);
}

async function migrateNovels() {
  const novels = await readJsonFile("data/novels.json", []);
  let novelCount = 0;
  let genreCount = 0;
  let chapterCount = 0;

  for (const n of novels) {
    await query(
      `INSERT INTO novels
         (id, novel_url, title, description, description_html, cover_url,
          author, status, first_chapter_url, latest_chapter_name,
          latest_chapter_url, added_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        n.id,
        n.novelUrl,
        n.title,
        n.description,
        n.descriptionHtml,
        n.coverUrl,
        n.author,
        n.status,
        n.firstChapterUrl,
        n.latestChapterName,
        n.latestChapterUrl,
        n.addedBy,
        n.createdAt,
      ]
    );
    novelCount++;

    for (const genre of n.genres || []) {
      await query(
        `INSERT INTO novel_genres (novel_id, genre) VALUES ($1, $2)
         ON CONFLICT (novel_id, genre) DO NOTHING`,
        [n.id, genre]
      );
      genreCount++;
    }

    const chapters = n.chapters || [];
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      await query(
        `INSERT INTO novel_chapters (novel_id, chapter_id, title, url, position)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (novel_id, chapter_id) DO NOTHING`,
        [n.id, c.id, c.title, c.url, i + 1]
      );
      chapterCount++;
    }
  }
  console.log(`novels: ${novelCount}, genres: ${genreCount}, chapters: ${chapterCount}`);
}

async function migrateProgress() {
  const all = await readJsonFile("data/progress.json", {});
  let count = 0;
  for (const [userId, byNovel] of Object.entries(all)) {
    for (const [novelId, p] of Object.entries(byNovel)) {
      await query(
        `INSERT INTO progress
           (user_id, novel_id, chapter_id, chapter_title, chapter_url, percent, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, novel_id) DO NOTHING`,
        [userId, novelId, p.chapterId, p.chapterTitle, p.chapterUrl, p.percent, p.updatedAt]
      );
      count++;
    }
  }
  console.log(`progress: ${count}`);
}

async function migrateBookmarks() {
  const all = await readJsonFile("data/bookmarks.json", {});
  let count = 0;
  for (const [userId, list] of Object.entries(all)) {
    for (const b of list) {
      await query(
        `INSERT INTO bookmarks
           (user_id, novel_id, chapter_id, chapter_title, url, saved_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, chapter_id) DO NOTHING`,
        [userId, b.novelId, b.chapterId, b.chapterTitle, b.url, b.savedAt]
      );
      count++;
    }
  }
  console.log(`bookmarks: ${count}`);
}

async function main() {
  await migrateUsers();
  await migrateNovels();
  await migrateProgress();
  await migrateBookmarks();
  await pool.end();
  console.log("done");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
