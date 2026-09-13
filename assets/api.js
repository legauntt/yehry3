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
const roles = ["submitter", "admin"];
const authKey = (role) => `yehry3:auth:${role}`;
function readCredentials(role) {
  try {
    const saved = JSON.parse(localStorage.getItem(authKey(role)));
    if (saved && typeof saved === "object") {
      return {
        token: typeof saved.token === "string" ? saved.token : null,
        password: typeof saved.password === "string" ? saved.password : null,
      };
    }
  } catch {
    /* Storage may be unavailable or contain an older value. */
  }
  return { token: storage.get(role), password: null };
}
const credentials = Object.fromEntries(
  roles.map((role) => [role, readCredentials(role)]),
);
const generations = { submitter: 0, admin: 0 };
const renewals = {};
export const signedIn = (role) =>
  Boolean(credentials[role]?.token || credentials[role]?.password);
export function loginPersistence(role) {
  if (!credentials[role]?.password) return "session";
  try {
    const saved = JSON.parse(localStorage.getItem(authKey(role)));
    if (saved?.password === credentials[role].password) return "saved";
  } catch {
    /* The browser may prevent persistent storage. */
  }
  return "temporary";
}
function remember(role, value) {
  credentials[role] = value;
  storage.remove(role);
  try {
    localStorage.setItem(authKey(role), JSON.stringify(value));
  } catch {
    /* Sign-in still works in this page when storage is blocked. */
  }
}
export function logout(role) {
  generations[role]++;
  delete renewals[role];
  credentials[role] = {};
  storage.remove(role);
  try {
    localStorage.removeItem(authKey(role));
  } catch {
    /* The in-memory login is still cleared. */
  }
}
window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage) return;
  for (const role of roles) {
    if (event.key !== null && event.key !== authKey(role)) continue;
    storage.remove(role);
    credentials[role] = readCredentials(role);
    if (!signedIn(role)) {
      generations[role]++;
      delete renewals[role];
    }
  }
});
function signedOutError() {
  return Object.assign(new Error("Please sign in again."), { status: 401 });
}
async function request(path, { method = "GET", body } = {}, token) {
  const headers = { "X-Visitor-ID": visitor };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
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
    const error = new Error(
      data.error || "That did not go through. Please try again.",
    );
    error.status = response.status;
    error.retryAt = data.retryAt;
    throw error;
  }
  return data;
}
async function renew(role) {
  if (renewals[role]) return renewals[role];
  const previous = credentials[role];
  const password = previous?.password;
  if (!password) throw signedOutError();
  const generation = generations[role];
  const pending = request("/session", {
    method: "POST",
    body: { role, password },
  })
    .then(({ token }) => {
      if (generation !== generations[role]) throw signedOutError();
      // A newer login in this page or another tab takes precedence.
      if (credentials[role] === previous) remember(role, { token, password });
    })
    .catch((error) => {
      if (generation !== generations[role]) throw signedOutError();
      if (credentials[role] !== previous) return;
      if ([401, 403].includes(error.status)) {
        logout(role);
        error.status = 401;
      }
      throw error;
    })
    .finally(() => {
      if (renewals[role] === pending) delete renewals[role];
    });
  renewals[role] = pending;
  return pending;
}
export async function api(path, options = {}) {
  const { role } = options;
  if (!role) return request(path, options);
  const generation = generations[role];
  let renewed = false;
  if (!credentials[role]?.token && credentials[role]?.password) {
    await renew(role);
    renewed = true;
  }
  while (true) {
    if (generation !== generations[role]) throw signedOutError();
    const token = credentials[role]?.token;
    try {
      const data = await request(path, options, token);
      if (generation !== generations[role]) throw signedOutError();
      return data;
    } catch (error) {
      if (generation !== generations[role]) throw signedOutError();
      if (error.status !== 401) throw error;
      if (!renewed && credentials[role]?.password) {
        // Another request may already have renewed this token.
        if (credentials[role].token === token) await renew(role);
        renewed = true;
        continue;
      }
      if (credentials[role]?.password) {
        // The password exchange succeeded. A rejected session is not evidence
        // that the saved password is wrong; retain it for the next attempt.
        throw Object.assign(
          new Error("The studio could not restore your session. Your password is still remembered; please try again."),
          { status: 503 },
        );
      }
      logout(role);
      throw error;
    }
  }
}
export async function login(role, password) {
  const generation = generations[role];
  const { token } = await request("/session", {
    method: "POST",
    body: { role, password },
  });
  if (generation !== generations[role]) throw signedOutError();
  remember(role, { token, password });
}
