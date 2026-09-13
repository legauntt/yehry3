import test from "node:test";
import assert from "node:assert/strict";

const savedKey = (role) => `yehry3:auth:${role}`;
const json = (data, status = 200) => Response.json(data, { status });
function store() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function client(t, fetch, local = store(), session = store()) {
  const events = {};
  const globals = {
    location: { hostname: "localhost" },
    localStorage: local,
    sessionStorage: session,
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
    fetch,
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  const url = new URL("../assets/api.js", import.meta.url);
  url.searchParams.set("test", crypto.randomUUID());
  return { ...(await import(url)), local, session, events };
}

test("only successful passwords are saved, independently for each role", async (t) => {
  const auth = await client(t, async (url, options) => {
    if (!url.endsWith("/session")) {
      assert.equal(options.headers.Authorization, undefined);
      return json({ songs: [] });
    }
    const { role, password } = JSON.parse(options.body);
    return password === "wrong" ? json({ error: "Wrong password" }, 403) : json({ token: `${role}-token` });
  });
  await assert.rejects(auth.login("admin", "wrong"), { status: 403 });
  assert.equal(auth.local.getItem(savedKey("admin")), null);
  await auth.login("admin", "admin-password");
  await auth.login("submitter", "request-password");
  await assert.rejects(auth.login("admin", "wrong"), { status: 403 });
  assert.deepEqual(JSON.parse(auth.local.getItem(savedKey("admin"))), { token: "admin-token", password: "admin-password" });
  await auth.api("/songs");
  auth.logout("admin");
  assert.equal(auth.signedIn("admin"), false);
  assert.equal(auth.local.getItem(savedKey("admin")), null);
  assert.equal(auth.signedIn("submitter"), true);
});

test("a reopened browser uses the remembered session without another password exchange", async (t) => {
  const local = store();
  local.setItem(savedKey("admin"), JSON.stringify({ token: "saved-token", password: "saved-password" }));
  const auth = await client(t, async (url, options) => {
    assert.ok(url.endsWith("/admin/prompts"));
    assert.equal(options.headers.Authorization, "Bearer saved-token");
    return json({ prompts: [] });
  }, local);
  assert.equal(auth.signedIn("admin"), true);
  assert.equal(auth.session.getItem("yehry3:admin"), null);
  assert.deepEqual(await auth.api("/admin/prompts", { role: "admin" }), { prompts: [] });
});

test("concurrent expired requests share one renewal and replay their original changes", async (t) => {
  let logins = 0;
  let writes = 0;
  const auth = await client(t, async (url, options) => {
    if (url.endsWith("/session")) {
      logins++;
      await new Promise(setImmediate);
      return json({ token: logins === 1 ? "old" : "fresh" });
    }
    assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), { priority: 12, version: 3 });
    if (options.headers.Authorization === "Bearer old") return json({}, 401);
    assert.equal(options.headers.Authorization, "Bearer fresh");
    writes++;
    return json({ saved: true });
  });
  await auth.login("admin", "remember-me");
  const options = { role: "admin", method: "PATCH", body: { priority: 12, version: 3 } };
  await Promise.all([auth.api("/admin/prompts/one", options), auth.api("/admin/prompts/two", options)]);
  assert.equal(logins, 2);
  assert.equal(writes, 2);
});

test("a rejected remembered password is forgotten without a retry loop", async (t) => {
  let logins = 0;
  const local = store();
  local.setItem(savedKey("admin"), JSON.stringify({ token: "expired", password: "changed" }));
  const auth = await client(t, async (url) => {
    if (url.endsWith("/session")) {
      logins++;
      return json({ error: "That password did not work." }, 403);
    }
    return json({}, 401);
  }, local);
  await assert.rejects(auth.api("/admin/prompts", { role: "admin" }), { status: 401 });
  await assert.rejects(auth.api("/admin/prompts", { role: "admin" }), { status: 401 });
  assert.equal(logins, 1);
  assert.equal(auth.signedIn("admin"), false);
  assert.equal(local.getItem(savedKey("admin")), null);
});

test("a rejected renewed token stops after one renewal", async (t) => {
  let logins = 0;
  let requests = 0;
  const auth = await client(t, async (url) => {
    if (url.endsWith("/session")) return json({ token: `token-${++logins}` });
    requests++;
    return json({}, 401);
  });
  await auth.login("admin", "password");
  await assert.rejects(auth.api("/admin/prompts", { role: "admin" }), { status: 401 });
  assert.equal(logins, 2);
  assert.equal(requests, 2);
  assert.equal(auth.signedIn("admin"), false);
});

for (const failure of [503, 429, "offline"]) {
  test(`renewal preserves the saved password during ${failure} and recovers on retry`, async (t) => {
    let available = false;
    const local = store();
    local.setItem(savedKey("admin"), JSON.stringify({ token: "expired", password: "remember-me" }));
    const auth = await client(t, async (url, options) => {
      if (url.endsWith("/session")) {
        if (available) return json({ token: "fresh" });
        if (failure === "offline") throw new TypeError("Network unavailable");
        return json({ error: "Try again later" }, failure);
      }
      return options.headers.Authorization === "Bearer fresh" ? json({ prompts: [] }) : json({}, 401);
    }, local);
    await assert.rejects(auth.api("/admin/prompts", { role: "admin" }));
    assert.equal(JSON.parse(local.getItem(savedKey("admin"))).password, "remember-me");
    available = true;
    assert.deepEqual(await auth.api("/admin/prompts", { role: "admin" }), { prompts: [] });
  });
}

test("signing out during renewal prevents the pending login from restoring access", async (t) => {
  const started = deferred();
  const finish = deferred();
  const local = store();
  local.setItem(savedKey("admin"), JSON.stringify({ token: "expired", password: "remember-me" }));
  const auth = await client(t, async (url) => {
    if (url.endsWith("/session")) {
      started.resolve();
      await finish.promise;
      return json({ token: "fresh" });
    }
    return json({}, 401);
  }, local);
  const rejected = assert.rejects(auth.api("/admin/prompts", { role: "admin" }), { status: 401 });
  await started.promise;
  auth.logout("admin");
  finish.resolve();
  await rejected;
  assert.equal(local.getItem(savedKey("admin")), null);
  assert.equal(auth.signedIn("admin"), false);
});

test("sign-in still works for the current page when browser storage is blocked", async (t) => {
  const blocked = () => { throw new Error("Storage blocked"); };
  const unavailable = { getItem: blocked, setItem: blocked, removeItem: blocked };
  const auth = await client(t, async (url, options) => {
    if (url.endsWith("/session")) return json({ token: "memory-token" });
    assert.equal(options.headers.Authorization, "Bearer memory-token");
    return json({ prompts: [] });
  }, unavailable, unavailable);
  await auth.login("admin", "password");
  assert.equal(auth.signedIn("admin"), true);
  await auth.api("/admin/prompts", { role: "admin" });
  auth.logout("admin");
  assert.equal(auth.signedIn("admin"), false);
});

test("legacy sessions work and signing out in another tab clears them", async (t) => {
  const local = store();
  const session = store();
  session.setItem("yehry3:admin", "legacy-token");
  const auth = await client(t, async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer legacy-token");
    return json({ prompts: [] });
  }, local, session);
  await auth.api("/admin/prompts", { role: "admin" });
  auth.events.storage({ key: savedKey("admin"), newValue: null, storageArea: local });
  assert.equal(auth.signedIn("admin"), false);
  assert.equal(session.getItem("yehry3:admin"), null);
});
