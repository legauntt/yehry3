import { API_BASE } from "./config.js";

export const storage = {
  get(key) {
    try {
      return sessionStorage.getItem(`yehry3:${key}`);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(`yehry3:${key}`, value);
    } catch {
      /* memory still works */
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(`yehry3:${key}`);
    } catch {
      /* no storage */
    }
  },
};
let visitor;
try {
  visitor = localStorage.getItem("yehry3:visitor");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(visitor || "")) {
    visitor = crypto.randomUUID();
    localStorage.setItem("yehry3:visitor", visitor);
  }
} catch {
  visitor = crypto.randomUUID();
}
const tokens = {
  submitter: storage.get("submitter"),
  admin: storage.get("admin"),
};
export const signedIn = (role) => Boolean(tokens[role]);
export function logout(role) {
  tokens[role] = null;
  storage.remove(role);
}
export async function api(path, { method = "GET", body, role } = {}) {
  const headers = { "X-Visitor-ID": visitor };
  if (body) headers["Content-Type"] = "application/json";
  if (role && tokens[role]) headers.Authorization = `Bearer ${tokens[role]}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("The studio is unreachable. Please try again in a moment.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && role) logout(role);
    const error = new Error(
      data.error || "That did not go through. Please try again.",
    );
    error.status = response.status;
    error.retryAt = data.retryAt;
    throw error;
  }
  return data;
}
export async function login(role, password) {
  const { token } = await api("/session", {
    method: "POST",
    body: { role, password },
  });
  tokens[role] = token;
  storage.set(role, token);
}
