const routes = [];
let notFoundHandler = () => {};

/** Register a route. Pattern supports `:param` segments, e.g. "/novel/:id". */
export function route(pattern, handler) {
  const paramNames = [];
  const regexStr = pattern
    .replace(/\/:[^/]+/g, (m) => {
      paramNames.push(m.slice(2)); // drop "/:"
      return "/([^/]+)";
    })
    .replace(/\//g, "\\/");
  const regex = new RegExp(`^${regexStr}\\/?$`);
  routes.push({ regex, paramNames, handler });
}

export function notFound(handler) {
  notFoundHandler = handler;
}

function currentFullPath() {
  return location.hash.slice(1) || "/"; // drop leading '#'
}

function parseQuery(fullPath) {
  const idx = fullPath.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(fullPath.slice(idx + 1)).entries());
}

function dispatch() {
  const fullPath = currentFullPath();
  const path = fullPath.split("?")[0];
  const query = parseQuery(fullPath);

  for (const r of routes) {
    const match = r.regex.exec(path);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      r.handler({ params, query });
      return;
    }
  }
  notFoundHandler({ path, query });
}

/** Build a "#/path?query" string, e.g. navigate("/novel/:id", { id }) style helpers can wrap this. */
export function hashFor(path, query) {
  const qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return `#${path}${qs}`;
}

export function navigate(path, query) {
  const target = hashFor(path, query);
  if (location.hash === target) {
    dispatch(); // same hash — re-run anyway so "navigating" to the current view still refreshes it
  } else {
    location.hash = target;
  }
}

export function startRouter() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}
