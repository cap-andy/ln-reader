async function request(method, url, body) {
  const opts = { method, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  me: () => request("GET", "/api/auth/me"),
  register: (username, password) => request("POST", "/api/auth/register", { username, password }),
  login: (username, password) => request("POST", "/api/auth/login", { username, password }),
  logout: () => request("POST", "/api/auth/logout"),

  // novels (global)
  listNovels: () => request("GET", "/api/novels"),
  getNovel: (id) => request("GET", `/api/novels/${encodeURIComponent(id)}`),
  addNovelByUrl: (url) => request("POST", "/api/novels/fetch", { url }),
  addNovelByHtml: (html, url) => request("POST", "/api/novels/parse", { html, url }),
  deleteNovel: (id) => request("DELETE", `/api/novels/${encodeURIComponent(id)}`),

  // chapters
  fetchChapter: (url) => request("GET", `/api/chapter?url=${encodeURIComponent(url)}`),
  parseChapterHtml: (html, url) => request("POST", "/api/parse", { html, url }),

  // reading progress (per logged-in user, per novel)
  getAllProgress: () => request("GET", "/api/progress"),
  getProgress: (novelId) => request("GET", `/api/progress/${encodeURIComponent(novelId)}`),
  saveProgress: (novelId, payload) => request("PUT", `/api/progress/${encodeURIComponent(novelId)}`, payload),
  continueReading: () => request("GET", "/api/continue"),

  // bookmarks (per logged-in user)
  listBookmarks: () => request("GET", "/api/bookmarks"),
  addBookmark: (payload) => request("POST", "/api/bookmarks", payload),
  removeBookmark: (chapterId) => request("DELETE", `/api/bookmarks/${encodeURIComponent(chapterId)}`),
};
