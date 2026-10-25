import { api } from "../api.js";
import { state, setUser, onUserChange } from "../state.js";
import { navigate } from "../router.js";

const el = (id) => document.getElementById(id);

const authArea = el("authArea");
const viewAuth = el("view-auth");

const authTabLogin = el("authTabLogin");
const authTabRegister = el("authTabRegister");
const authForm = el("authForm");
const authUsername = el("authUsername");
const authPassword = el("authPassword");
const authSubmitBtn = el("authSubmitBtn");
const authError = el("authError");

let mode = "login"; // "login" | "register"
// Where to send the person after they successfully log in/register — set by
// whatever redirected them here (e.g. "Add novel" while logged out).
let redirectAfterAuth = "/";

export function setAuthMode(newMode) {
  mode = newMode;
  authTabLogin.classList.toggle("active", mode === "login");
  authTabRegister.classList.toggle("active", mode === "register");
  authSubmitBtn.textContent = mode === "login" ? "Log in" : "Create account";
  authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
  authError.classList.add("hidden");
}

export function showAuthView({ mode: requestedMode, redirect } = {}) {
  if (requestedMode) setAuthMode(requestedMode);
  redirectAfterAuth = redirect || "/";
  authUsername.value = "";
  authPassword.value = "";
  authError.classList.add("hidden");
  authUsername.focus();
}

authTabLogin.addEventListener("click", () => setAuthMode("login"));
authTabRegister.addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authSubmitBtn.disabled = true;
  try {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    const user = mode === "login" ? await api.login(username, password) : await api.register(username, password);
    setUser(user);
    navigate(redirectAfterAuth);
  } catch (err) {
    authError.textContent = err.message || "Something went wrong.";
    authError.classList.remove("hidden");
  } finally {
    authSubmitBtn.disabled = false;
  }
});

function renderAuthArea(user) {
  authArea.innerHTML = "";
  if (user) {
    const span = document.createElement("span");
    span.className = "auth-username";
    span.textContent = user.username;
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "icon-btn";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async () => {
      await api.logout();
      setUser(null);
      navigate("/");
    });
    authArea.append(span, logoutBtn);
  } else {
    const loginBtn = document.createElement("button");
    loginBtn.className = "icon-btn";
    loginBtn.textContent = "Log in";
    loginBtn.addEventListener("click", () => navigate("/login"));
    authArea.append(loginBtn);
  }
}

onUserChange(renderAuthArea);
renderAuthArea(state.user);

/** Loads /api/auth/me once at startup to find out if there's an existing session. */
export async function initAuth() {
  try {
    const user = await api.me();
    setUser(user);
  } catch {
    setUser(null);
  }
}

export function mountAuthView() {
  viewAuth.classList.remove("hidden");
}
