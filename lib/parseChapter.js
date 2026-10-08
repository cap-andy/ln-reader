import * as cheerio from "cheerio";

/**
 * Parses a NovelPing chapter page (raw HTML string) into a clean,
 * structured object: title, paragraphs, and prev/next chapter links.
 *
 * This is DOM-attribute based on purpose, not based on the inline
 * `window.__CHAPTER_READER__` script blob: that blob references other
 * JS variables (`novel: novel`, `chapter: chapter`, `url: nextChapterUrl`)
 * rather than inline literal values, so it is not valid JSON and can't be
 * parsed directly. Plain HTML attributes are a much more stable source:
 *
 *  - `#chr-content[data-chapter-id]`            → current chapter id
 *  - `#chr-content > p`                         → chapter text (skips the
 *                                                  `.js-ad-slot` divs that
 *                                                  sit alongside the <p>s)
 *  - `a.novel-title`                            → novel title + url
 *  - `.chr-title .chr-text`                     → chapter title
 *  - `a.js-chapter-nav[data-chapter-nav=prev|next]` → prev/next chapter
 *    (id/url/name via `data-chapter-id`, `data-chapter-url`, `title`)
 */
export function parseChapterHtml(html, sourceUrl = null) {
  const $ = cheerio.load(html);

  const contentRoot = $("#chr-content").first();
  if (contentRoot.length === 0) {
    throw new Error(
      "Could not find #chr-content on this page — it may not be a chapter page, " +
        "or the site's layout has changed."
    );
  }

  const paragraphs = [];
  contentRoot.children("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text) paragraphs.push(text);
  });

  if (paragraphs.length === 0) {
    throw new Error(
      "No chapter paragraphs found (#chr-content had no <p> children)."
    );
  }

  const chapterId = contentRoot.attr("data-chapter-id") || null;

  const chapterTitle =
    $(".chr-title .chr-text").first().text().trim() ||
    $("[data-reader-breadcrumb-chapter]").first().text().trim() ||
    $("h1, h2").first().text().trim() ||
    "Untitled chapter";

  const novelLink = $("a.novel-title").first();
  const novelTitle = novelLink.text().trim() || "Unknown novel";
  const novelUrl = novelLink.attr("href") || null;

  const canonicalUrl = $('link[rel="canonical"]').attr("href") || null;
  const chapterUrl = sourceUrl || canonicalUrl || null;

  function readNavLink(direction) {
    const a = $(`a.js-chapter-nav[data-chapter-nav="${direction}"]`).first();
    if (a.length === 0) return null;
    const url = a.attr("data-chapter-url") || a.attr("href") || null;
    // A disabled/absent prev or next link (e.g. chapter 1 has no prev) often
    // still renders an <a> with a placeholder href rather than omitting the
    // tag entirely — treat those as "no such chapter" instead of a real url.
    if (!url || url === "#" || url.startsWith("javascript:")) return null;
    return {
      id: a.attr("data-chapter-id") || null,
      name: (a.attr("title") || "").trim(),
      url,
    };
  }

  return {
    novelTitle,
    novelUrl,
    chapterTitle,
    chapterId,
    chapterUrl,
    prevChapter: readNavLink("prev"),
    nextChapter: readNavLink("next"),
    paragraphs,
  };
}

/** Deterministic, filesystem-safe cache key for a chapter. */
export function cacheKeyForChapter(chapterIdOrUrl) {
  return Buffer.from(String(chapterIdOrUrl))
    .toString("base64url")
    .slice(0, 180);
}
