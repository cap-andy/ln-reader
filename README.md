# LN Reader

A small local app: Node/Express backend + vanilla HTML/CSS/JS frontend,
built to read chapters from `novelping.com` (and similar sites that reuse
the same `__CHAPTER_READER__` page structure) with your own reading UI.

## Setup

```bash
cd ln-reader
npm install
npm start
```

Then open http://localhost:3000

## How it works

- **Live fetch (`/api/chapter?url=`)**: the server fetches the chapter page
  itself and parses it. Throttled to one request per ~2s, and every result
  is cached to `data/cache/` so a chapter is never re-fetched once read.
- **Paste fallback (`/api/parse`)**: `novelping.com`'s `robots.txt`
  disallows automated access, and the page is also behind Cloudflare, so
  live fetch may fail outright. If it does, click **"Paste HTML instead"**,
  open the chapter in your own browser, View Page Source (Ctrl/Cmd+U),
  copy-paste the whole thing in, and it parses exactly the same way.
- **Parsing (`lib/parseChapter.js`)**: pulls paragraph text from
  `#chr-content > p`, and chapter/novel title + prev/next chapter URLs from
  the `window.__CHAPTER_READER__` JSON blob the site embeds in the page
  (more robust than scraping nav button classes).

## Features

- Dark mode toggle (persisted)
- Font size / line height controls (persisted)
- Reading progress — saves scroll position per chapter (both locally and
  to `data/progress.json`), offers to resume on reload
- Bookmarks — saved to `data/bookmarks.json`, browsable in the side panel
- Auto-next — optional toggle; when you scroll near the bottom of a
  chapter it automatically loads the next one

## A note on `robots.txt`

`novelping.com/robots.txt` disallows automated crawling. This tool only
fetches a page when *you* explicitly ask for a specific chapter (no
crawling/bulk-downloading), throttles requests, and caches aggressively to
minimize repeat hits — but it's still worth knowing the site has asked bots
to stay out. If live fetch keeps failing, that's likely why; the paste
fallback exists for exactly that case.

## Extending to other sites

`parseChapterHtml` is novelping-specific right now (it looks for
`#chr-content` and `window.__CHAPTER_READER__`). To support another site,
either add a second parser function keyed off the domain, or adjust the
selectors if the new site's markup is similar.
