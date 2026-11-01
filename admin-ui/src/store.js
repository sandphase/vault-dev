import { createSignal } from "solid-js";

const TOKEN_KEY = "vault_token";

function readStoredToken() {
  try {
    const session = sessionStorage.getItem(TOKEN_KEY);
    if (session) return session;
    const legacy = localStorage.getItem(TOKEN_KEY);
    if (legacy) {
      sessionStorage.setItem(TOKEN_KEY, legacy);
      localStorage.removeItem(TOKEN_KEY);
      return legacy;
    }
  } catch (e) {}
  return "";
}

export const [healthReady, setHealthReady] = createSignal(false);
export const [isSealed, setIsSealed] = createSignal(true);
export const [hasData, setHasData] = createSignal(false);
export const [serverReachable, setServerReachable] = createSignal(true);
export const [token, setToken] = createSignal(readStoredToken());
export const [menuOpen, setMenuOpen] = createSignal(false);

export const [toasts, setToasts] = createSignal([]);
export const addToast = (message, type = "success") => {
  const id = Date.now() + Math.random();
  setToasts((t) => [...t, { id, message, type }]);
  const ms = type === "error" ? 8000 : type === "warning" ? 6000 : 4000;
  if (type !== "error") {
    setTimeout(() => setToasts((t) => t.filter((toast) => toast.id !== id)), ms);
  }
};

export const saveToken = (newToken) => {
  setToken(newToken || "");
  try {
    if (newToken) {
      sessionStorage.setItem(TOKEN_KEY, newToken);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
};

export const expireSession = (message = "Session expired. Sign in again.") => {
  saveToken("");
  if (message) addToast(message, "error");
};

export const dismissToast = (id) => {
  setToasts((t) => t.filter((toast) => toast.id !== id));
};

export async function vaultFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers["x-vault-token"] = token();
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    expireSession();
    throw new Error("Session expired. Sign in again.");
  }
  return res;
}

export function encodeSecretPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
