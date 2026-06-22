// Headless smoke test for the ForgeLift app using jsdom.
//
// The app authenticates through window.ForgeLiftAuth (Supabase Auth + a per-user
// `profiles` row in the browser). Here we swap in an in-memory mock with the same
// shape — email/password accounts, OAuth stubs, and a profiles store — so the real
// app flows run without a network or a live database.
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("js/app.js", "utf8");

const vc = new VirtualConsole();
vc.on("jsdomError", () => {});

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://localhost/", virtualConsole: vc });
const { window } = dom;
const { document } = window;

// Stubs for browser APIs jsdom doesn't fully implement
window.confirm = () => true;
window.alert = () => {};
window.URL.createObjectURL = () => "blob:mock";
window.URL.revokeObjectURL = () => {};
if (!window.Blob.prototype.text) {
  window.Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const fr = new window.FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsText(this);
    });
  };
}

// ── in-memory stand-in for Supabase Auth + the profiles table ──
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
const auth = {
  users: {},        // email -> { id, password }
  profiles: {},     // userId -> profile data
  session: null,    // { user: { id, email, user_metadata } }
  listeners: [],
  lastOAuth: null,
  idSeq: 1,
};
function emit() { auth.listeners.forEach((cb) => cb(auth.session)); }
function setSession(user) { auth.session = user ? { user } : null; setTimeout(emit, 0); }

window.ForgeLiftAuth = {
  ready: true,
  onChange(cb) { auth.listeners.push(cb); setTimeout(() => cb(auth.session), 0); },
  getSession() { return Promise.resolve(auth.session); },
  signUpEmail(email, password) {
    return Promise.resolve().then(() => {
      email = String(email).trim().toLowerCase();
      if (auth.users[email]) return { data: {}, error: { message: "User already registered" } };
      const id = "user-" + auth.idSeq++;
      auth.users[email] = { id, password };
      // Simulate a project with email confirmation OFF → immediate session.
      const user = { id, email, user_metadata: {} };
      setSession(user);
      return { data: { session: { user }, user }, error: null };
    });
  },
  signInEmail(email, password) {
    return Promise.resolve().then(() => {
      email = String(email).trim().toLowerCase();
      const u = auth.users[email];
      if (!u || u.password !== password) return { data: {}, error: { message: "Invalid login credentials" } };
      setSession({ id: u.id, email, user_metadata: {} });
      return { data: { session: auth.session }, error: null };
    });
  },
  signInApple() { auth.lastOAuth = "apple"; return Promise.resolve({ data: {}, error: { message: "provider is not enabled" } }); },
  signInGoogle() { auth.lastOAuth = "google"; return Promise.resolve({ data: {}, error: { message: "provider is not enabled" } }); },
  signOut() { setSession(null); return Promise.resolve({ error: null }); },
  loadProfile() {
    return Promise.resolve().then(() => (auth.session ? (auth.profiles[auth.session.user.id] || null) : null));
  },
  saveProfile(userId, data) {
    return Promise.resolve().then(() => { auth.profiles[userId] = clone(data); });
  },
  deleteProfile(userId) {
    return Promise.resolve().then(() => { delete auth.profiles[userId]; });
  },
};

window.eval(js);

function $(sel) { return document.querySelector(sel); }
function click(sel) {
  const el = $(sel);
  if (!el) throw new Error("missing element: " + sel);
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
}
function setInput(sel, val) {
  const el = $(sel);
  el.value = val;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function idByName(name) {
  const rows = [...document.querySelectorAll('[data-action="open-machine"]')];
  const row = rows.find((r) => r.textContent.includes(name));
  return row && row.getAttribute("data-id");
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function modeIsSignup() {
  const b = $('[data-action="auth-email"]');
  return !!b && /Create account/.test(b.textContent);
}
async function ensureMode(signup) {
  if (modeIsSignup() !== signup) click('[data-action="auth-toggle"]');
}
async function signUp(email, password) {
  await ensureMode(true);
  setInput("#input-email", email);
  setInput("#input-password", password);
  click('[data-action="auth-email"]');
  await wait(60);
}
async function signIn(email, password) {
  await ensureMode(false);
  setInput("#input-email", email);
  setInput("#input-password", password);
  click('[data-action="auth-email"]');
  await wait(60);
}
function currentProfile() { return auth.session ? auth.profiles[auth.session.user.id] : null; }

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

(async function () {
  await wait(20); // let boot() resolve the (empty) initial session

  console.log("LOGIN SCREEN");
  check("login screen rendered", /FORGE/.test($("#app").textContent));
  check("Apple + Google + email options present", !!$('[data-action="auth-apple"]') && !!$('[data-action="auth-google"]') && !!$("#input-email"));

  console.log("OAUTH (not configured → friendly error)");
  click('[data-action="auth-google"]');
  await wait(20);
  check("google button invokes google provider", auth.lastOAuth === "google");
  check("shows not-enabled message", /GOOGLE SIGN-IN NOT ENABLED/.test($("#app").textContent));

  console.log("EMAIL VALIDATION");
  await ensureMode(false);
  setInput("#input-email", "bad");
  setInput("#input-password", "123");
  click('[data-action="auth-email"]');
  await wait(20);
  check("rejects invalid email", /VALID EMAIL/.test($("#app").textContent));
  setInput("#input-email", "demo@forgelift.test");
  setInput("#input-password", "123");
  click('[data-action="auth-email"]');
  await wait(20);
  check("rejects short password", /6\+ CHARACTERS/.test($("#app").textContent));

  console.log("SIGN UP");
  await signUp("demo@forgelift.test", "secret1");
  check("new account lands on home", /MACHINES/.test($("#app").textContent));
  check("machine catalog present (Chest Press)", /Chest Press/.test($("#app").textContent));
  check("no example history", !/Last · \d/.test($("#app").textContent));
  check("profile row created on first sign-in", !!currentProfile());
  const demoId = auth.session.user.id;

  console.log("FAVORITES + SEARCH");
  click('[data-action="toggle-fav"][data-id="m0"]');
  check("favorites group appears", /Favorites/.test($("#app").textContent));
  click('[data-action="toggle-fav"][data-id="m0"]');
  check("favorites group gone", !/Favorites/.test($("#app").textContent));
  setInput("#input-search", "leg");
  check("search filters to leg machines", /Leg Press/.test($("#app").textContent) && !/Chest Press/.test($("#app").textContent));
  setInput("#input-search", "");

  console.log("LOG A SET");
  click('[data-action="open-machine"][data-id="m0"]');
  check("machine detail shows Personal Best", /Personal Best/.test($("#app").textContent));
  click('[data-action="add-set"]');
  check("a draft set appears", /SET 01/.test($("#app").textContent));
  click('[data-action="rep-up"]');
  click('[data-action="w-up"]');
  click('[data-action="save-session"]');
  await wait(20);
  check("session saved (draft cleared)", !/SET 01/.test($("#app").textContent));
  check("chart rendered after first session", !!$("polyline"));
  check("persisted to profile", !!(currentProfile() && currentProfile().logs && currentProfile().logs.m0));

  console.log("CARDIO");
  click('[data-action="go-home"]');
  const tid = idByName("Treadmill");
  click('[data-action="open-machine"][data-id="' + tid + '"]');
  check("cardio shows Longest Time", /Longest Time/.test($("#app").textContent) && !/Personal Best/.test($("#app").textContent));
  click('[data-action="add-set"]');
  check("cardio adds an Interval", /INTERVAL 01/.test($("#app").textContent));
  click('[data-action="dur-up"]');
  click('[data-action="save-session"]');
  await wait(20);
  check("cardio session saved", !/INTERVAL 01/.test($("#app").textContent));

  console.log("ADD MACHINE");
  click('[data-action="go-home"]');
  click('[data-action="open-add"]');
  setInput("#input-addname", "Smith Machine");
  click('[data-action="pick-group"][data-g="Legs"]');
  click('[data-action="save-machine"]');
  await wait(20);
  check("new machine on home", /Smith Machine/.test($("#app").textContent));

  console.log("SETTINGS");
  click('[data-action="open-settings"]');
  check("shows account email", /demo@forgelift\.test/.test($("#app").textContent));
  click('[data-action="theme-light"]');
  check("theme switched to light", $("#app").getAttribute("data-theme") === "light");
  click('[data-action="unit-lb"]');
  await wait(20);
  check("unit switched to lb (persisted)", currentProfile().unit === "lb");

  console.log("LOGOUT + RELOGIN");
  click('[data-action="logout"]');
  await wait(20);
  check("logged out to login", /FORGE/.test($("#app").textContent) && !!$("#input-email"));
  await signIn("demo@forgelift.test", "secret1");
  check("custom machine persisted across logout", /Smith Machine/.test($("#app").textContent));
  check("theme persisted (light)", $("#app").getAttribute("data-theme") === "light");

  console.log("WRONG PASSWORD");
  click('[data-action="open-settings"]');
  click('[data-action="logout"]');
  await wait(20);
  await signIn("demo@forgelift.test", "wrongpw");
  check("wrong password rejected", /WRONG EMAIL OR PASSWORD/.test($("#app").textContent));
  check("stays on login screen", !!$("#input-email"));
  await signIn("demo@forgelift.test", "secret1");
  check("correct password logs back in", /Smith Machine/.test($("#app").textContent));

  console.log("BACKUP / RESTORE / DELETE");
  const backup = { app: "ForgeLift", version: 1, data: clone(currentProfile()) };
  click('[data-action="open-settings"]');
  click('[data-action="export-backup"]');
  check("export falls back to download when share unsupported", /BACKUP DOWNLOADED/.test($("#app").textContent));

  // second account is isolated from the first
  click('[data-action="logout"]');
  await wait(20);
  await signUp("bob@forgelift.test", "secret2");
  check("second account starts without demo's machine", !/Smith Machine/.test($("#app").textContent));
  const bobId = auth.session.user.id;
  check("two distinct users", bobId !== demoId);

  // restore demo's backup into bob
  click('[data-action="open-settings"]');
  const input = $("#input-restore");
  const file = new window.File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(40);
  check("restore reports success", /BACKUP RESTORED/.test($("#app").textContent));
  check("restore persisted under bob", /Smith Machine/.test(JSON.stringify(auth.profiles[bobId] || {})));
  click('[data-action="go-home"]');
  check("restored machine visible on home", /Smith Machine/.test($("#app").textContent));

  // reject a non-backup file
  click('[data-action="open-settings"]');
  const input2 = $("#input-restore");
  const bad = new window.File(["not json at all"], "x.json", { type: "application/json" });
  Object.defineProperty(input2, "files", { value: [bad], configurable: true });
  input2.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(40);
  check("invalid file rejected", /INVALID FILE/.test($("#app").textContent));

  // delete account data
  click('[data-action="delete-account"]');
  await wait(20);
  check("delete returns to login", /FORGE/.test($("#app").textContent) && !!$("#input-email"));
  check("deleted profile removed from store", auth.profiles[bobId] === undefined);
  // demo's data is untouched by bob's delete
  check("other user's data intact", !!auth.profiles[demoId]);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
