import * as cheerio from "cheerio";
import { hashKey } from "./util.js";

/**
 * Parses a NovelPing novel page (raw HTML string) into a structured object:
 * title, description, cover, author, genres, status, and the chapter list
 * the page itself ships with (the site server-renders roughly the first
 * ~30 chapters into a <template data-first-chapter-template> and lazy-loads
 * the rest client-side, so long novels will have more chapters than this
 * list shows — that's fine, the reader already chains forward via each
 * chapter's own prev/next links, same as it does today).
 *
 * Selector notes (mirrors parseChapter.js's approach — prefer the most
 * stable source first):
 *  - `meta[property="og:novel:*"]` / `meta[name="description"]` — NovelPing
 *    ships rich Open Graph novel metadata; this is more stable than page
 *    markup and is tried first.
 *  - `#novel-description-content` — the full synopsis (the meta description
 *    is truncated for SEO).
 *  - `ul.info-meta > li` — the visible "Author / Genre / Status" rows,
 *    used as a fallback if the meta tags are ever missing.
 *  - `li[data-chapter-item]` — the
 *    statically-rendered chapter list entries.
 */
export function parseNovelHtml(html, sourceUrl = null) {
  const $ = cheerio.load(html);

  const canonicalUrl = $('link[rel="canonical"]').attr("href") || null;
  const novelUrl = sourceUrl || canonicalUrl || null;

  const metaContent = (selector) => $(selector).attr("content") || null;

  const title =
    $(".desc h3.title").first().text().trim() ||
    metaContent('meta[property="og:novel:novel_name"]') ||
    metaContent('meta[property="og:title"]')?.replace(/\s*\|\s*NovelPing\s*$/i, "").trim() ||
    null;

  const coverUrl =
    $(".book img.novel-cover-loading").first().attr("src") ||
    metaContent('meta[property="og:image"]') ||
    null;

  const descriptionHtml = $("#novel-description-content").first().html()?.trim() || null;
  const description =
    $("#novel-description-content").first().text().trim().replace(/\s+/g, " ") ||
    metaContent('meta[name="description"]') ||
    null;

  // Visible "Author / Genre / Status" list, as a label -> [values] fallback.
  const infoMeta = {};
  $(".info-meta > li").each((_, li) => {
    const label = $(li).find("> h3").first().text().replace(":", "").trim().toLowerCase();
    const values = $(li)
      .find("a")
      .map((_i, a) => $(a).text().trim())
      .get()
      .filter(Boolean);
    if (label) infoMeta[label] = values;
  });

  const author =
    metaContent('meta[property="og:novel:author"]') || infoMeta.author?.[0] || null;

  const genres = [];
  $('meta[property="og:novel:genre"]').each((_i, elm) => {
    const g = $(elm).attr("content");
    if (g) genres.push(g);
  });
  if (genres.length === 0 && infoMeta.genre) genres.push(...infoMeta.genre);

  const status = metaContent('meta[property="og:novel:status"]') || infoMeta.status?.[0] || null;

  const firstChapterUrl = metaContent('meta[property="og:novel:read_url"]');
  const latestChapterName = metaContent('meta[property="og:novel:lastest_chapter_name"]');
  const latestChapterUrl = metaContent('meta[property="og:novel:lastest_chapter_url"]');

  const chapters = [];
  const seenChapterIds = new Set();
  $(
    "li[data-chapter-item]"
  ).each((_i, elm) => {
    const id = $(elm).attr("data-chapter-id");
    if (!id || seenChapterIds.has(id)) return;
    const a = $(elm).find("a").first();
    const url = a.attr("href");
    if (!url) return;
    const chapterTitle = a.attr("title") || $(elm).find(".chapter-title").first().text().trim() || id;
    seenChapterIds.add(id);
    chapters.push({ id, title: chapterTitle, url });
  });

  if (!title && chapters.length === 0 && !description) {
    throw new Error(
      "Could not find novel details on this page — it may not be a NovelPing book page, " +
        "or the site's layout has changed."
    );
  }

  return {
    novelId: novelIdFromUrl(novelUrl) || hashKey(novelUrl || title),
    novelUrl,
    title: title || "Untitled novel",
    description,
    descriptionHtml,
    coverUrl,
    author,
    genres,
    status,
    firstChapterUrl,
    latestChapterName,
    latestChapterUrl,
    chapters,
  };
}

/** Extract the `<slug>` out of `.../book/<slug>` (or `.../book/<slug>/<chapter>`). */
export function novelIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("book");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {
    // not a valid absolute URL — fall through
  }
  return null;
}
