// ---- current user, with a tiny pub/sub so any view can react to login/logout ----

const userListeners = new Set();

export const state = {
  user: null, // { id, username } | null
};

export function setUser(user) {
  state.user = user;
  userListeners.forEach((fn) => fn(state.user));
}

export function onUserChange(fn) {
  userListeners.add(fn);
  return () => userListeners.delete(fn);
}

// ---- reading/display settings (unchanged behavior from the original app.js) ----

export const settings = {
  dark: localStorage.getItem("ln.dark") === "1",
  fontSize: parseInt(localStorage.getItem("ln.fontSize") || "18", 10),
  lineHeight: parseFloat(localStorage.getItem("ln.lineHeight") || "1.75"),
  fontFamily: localStorage.getItem("ln.fontFamily") || "georgia",
  autoNext: localStorage.getItem("ln.autoNext") === "1",
};

export function saveSettings() {
  localStorage.setItem("ln.dark", settings.dark ? "1" : "0");
  localStorage.setItem("ln.fontSize", String(settings.fontSize));
  localStorage.setItem("ln.lineHeight", String(settings.lineHeight));
  localStorage.setItem("ln.fontFamily", settings.fontFamily);
  localStorage.setItem("ln.autoNext", settings.autoNext ? "1" : "0");
}
