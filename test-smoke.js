// Headless smoke test for the ForgeLift app using jsdom.
//
// The app persists through window.ForgeLiftDB (Supabase RPCs in the browser).
// Here we swap in an in-memory mock with the same PIN-checked semantics, so the
// real app flows are exercised without a network or a live database.
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("js/app.js", "utf8");

// Silence jsdom's harmless "Not implemented: navigation" from the export <a> click
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
// jsdom 24 doesn't implement Blob/File.prototype.text(); back it with FileReader
// (which jsdom does support) so the share-sheet export test can read the payload.
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

// ── in-memory stand-in for the Supabase data layer ──
// One entry per account, mirroring public.accounts + the fl_* RPC behaviour.
// jsonb is cloned in/out so callers never share references with the store.
const accounts = {};
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
const key = (u) => String(u).trim().toLowerCase();
window.ForgeLiftDB = {
  login(username, pin) {
    return Promise.resolve().then(() => {
      const a = accounts[key(username)];
      if (!a) return { status: "new" };
      if (a.pin !== pin) return { status: "bad_pin" };
      return { status: "ok", data: { machines: clone(a.machines), logs: clone(a.logs), unit: a.unit, theme: a.theme } };
    });
  },
  signup(username, display, pin, data) {
    return Promise.resolve().then(() => {
      const k = key(username);
      if (accounts[k]) return { status: "exists" };
      accounts[k] = { pin, machines: clone(data.machines), logs: clone(data.logs), unit: data.unit, theme: data.theme };
      return { status: "ok" };
    });
  },
  save(username, pin, data) {
    return Promise.resolve().then(() => {
      const a = accounts[key(username)];
      if (!a) return { status: "no_account" };
      if (a.pin !== pin) return { status: "bad_pin" };
      a.machines = clone(data.machines); a.logs = clone(data.logs); a.unit = data.unit; a.theme = data.theme;
      return { status: "ok" };
    });
  },
  remove(username, pin) {
    return Promise.resolve().then(() => {
      const k = key(username);
      const a = accounts[k];
      if (!a) return { status: "no_account" };
      if (a.pin !== pin) return { status: "bad_pin" };
      delete accounts[k];
      return { status: "ok" };
    });
  },
};

// Run the app script in the window context
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
async function signIn(name, pin) {
  setInput("#input-username", name);
  pin.split("").forEach((d) => click('[data-action="pin"][data-d="' + d + '"]'));
  click('[data-action="do-login"]');
  await wait(20); // login → (maybe signup) → finishLogin
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

(async function () {
  console.log("LOGIN");
  check("login screen rendered", /FORGE/.test($("#app").textContent));
  setInput("#input-username", "demo");
  "1234".split("").forEach((d) => click('[data-action="pin"][data-d="' + d + '"]'));
  check("4 pin dots filled", $("#app").innerHTML.split("background:var(--accent);").length >= 5);
  click('[data-action="do-login"]');
  await wait(20);

  console.log("HOME");
  check("home shows MACHINES", /MACHINES/.test($("#app").textContent));
  check("machine catalog present (Chest Press)", /Chest Press/.test($("#app").textContent));
  check("no example history (no 'Last · kg' filled)", !/Last · \d/.test($("#app").textContent));
  check("no preset favorites group", !/Favorites/.test($("#app").textContent));

  console.log("FAVORITES");
  click('[data-action="toggle-fav"][data-id="m0"]');
  check("favorites group appears after marking one", /Favorites/.test($("#app").textContent));
  click('[data-action="toggle-fav"][data-id="m0"]');
  check("favorites group gone after unmarking", !/Favorites/.test($("#app").textContent));

  console.log("SEARCH");
  setInput("#input-search", "leg");
  check("search filters to leg machines", /Leg Press/.test($("#app").textContent) && !/Chest Press/.test($("#app").textContent));
  setInput("#input-search", "");

  console.log("MACHINE DETAIL + LOG A SET");
  click('[data-action="open-machine"][data-id="m0"]'); // Chest Press
  check("machine detail shows Personal Best", /Personal Best/.test($("#app").textContent));
  check("fresh machine has no chart yet", !$("polyline") && /NO DATA YET/.test($("#app").textContent));
  click('[data-action="add-set"]');
  check("a draft set appears", /SET 01/.test($("#app").textContent));
  const repsBefore = $('[data-action="rep-up"]').parentElement.querySelector("span").textContent;
  click('[data-action="rep-up"]');
  const repsAfter = $('[data-action="rep-up"]').parentElement.querySelector("span").textContent;
  check("rep + increments", Number(repsAfter) === Number(repsBefore) + 1);
  click('[data-action="w-up"]');
  check("save bar enabled", /Save Session/.test($("#app").textContent));
  click('[data-action="save-session"]');
  await wait(20);
  check("session saved (draft cleared)", !/SET 01/.test($("#app").textContent));
  check("chart now rendered after first session", !!$("polyline"));
  check("persisted to Supabase (accounts.demo has a Chest Press log)", !!(accounts.demo && accounts.demo.logs && accounts.demo.logs.m0));

  console.log("CARDIO MACHINE (context-aware logging)");
  click('[data-action="go-home"]'); // back from the Chest Press detail
  const tid = idByName("Treadmill");
  check("treadmill present in expanded catalog", !!tid);
  click('[data-action="open-machine"][data-id="' + tid + '"]');
  check("cardio shows Longest Time, not Personal Best", /Longest Time/.test($("#app").textContent) && !/Personal Best/.test($("#app").textContent));
  check("cardio chart titled by duration", /Duration · Over Time/.test($("#app").textContent));
  click('[data-action="add-set"]');
  check("cardio adds an Interval (not a Set)", /INTERVAL 01/.test($("#app").textContent) && !/SET 01/.test($("#app").textContent));
  check("cardio logs duration/distance, not reps/weight", /Duration/.test($("#app").textContent) && /Distance/.test($("#app").textContent) && !/Reps/.test($("#app").textContent));
  click('[data-action="dur-up"]');
  click('[data-action="dist-up"]');
  click('[data-action="cal-up"]');
  click('[data-action="save-session"]');
  await wait(20);
  check("cardio session saved (draft cleared)", !/INTERVAL 01/.test($("#app").textContent));
  check("cardio chart rendered after first session", !!$("polyline"));

  console.log("ADD MACHINE");
  click('[data-action="go-home"]');
  click('[data-action="open-add"]');
  check("new machine screen", /NEW MACHINE/.test($("#app").textContent));
  setInput("#input-addname", "Smith Machine");
  click('[data-action="pick-group"][data-g="Legs"]');
  click('[data-action="save-machine"]');
  await wait(20);
  check("new machine on home", /Smith Machine/.test($("#app").textContent));

  console.log("SETTINGS");
  click('[data-action="open-settings"]');
  check("settings screen", /SETTINGS/.test($("#app").textContent));
  click('[data-action="theme-light"]');
  check("theme switched to light", $("#app").getAttribute("data-theme") === "light");
  click('[data-action="unit-lb"]');
  await wait(20);
  check("unit switched to lb (persisted)", accounts.demo.unit === "lb");
  click('[data-action="logout"]');
  check("logged out to login", /FORGE/.test($("#app").textContent));

  console.log("\nRELOGIN PERSISTENCE");
  await signIn("demo", "1234");
  check("custom machine persisted across logout", /Smith Machine/.test($("#app").textContent));
  check("theme persisted (light)", $("#app").getAttribute("data-theme") === "light");

  console.log("\nWRONG PIN");
  click('[data-action="open-settings"]');
  click('[data-action="logout"]');
  await signIn("demo", "0000");
  check("wrong PIN is rejected", /WRONG PIN/.test($("#app").textContent));
  check("stays on login screen", /FORGE/.test($("#app").textContent));
  await signIn("demo", "1234");
  check("correct PIN logs back in", /Smith Machine/.test($("#app").textContent));

  console.log("\nBACKUP / RESTORE / DELETE");
  // demo is logged in with a custom "Smith Machine" — capture a backup payload
  const backup = { app: "ForgeLift", version: 1, data: clone(accounts.demo) };

  click('[data-action="open-settings"]');
  click('[data-action="export-backup"]');
  check("export falls back to download when share unsupported", /BACKUP DOWNLOADED/.test($("#app").textContent));

  // share-sheet path (iOS "Save to Files → iCloud Drive")
  let shared = null;
  Object.defineProperty(window.navigator, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(window.navigator, "share", { value: (d) => { shared = d; return Promise.resolve(); }, configurable: true });
  click('[data-action="export-backup"]');
  await wait(10);
  check("share sheet invoked with one file", !!(shared && shared.files && shared.files.length === 1));
  check("shared backup is the current user's data", /Smith Machine/.test(await shared.files[0].text()));
  check("share success reported", /BACKUP SHARED/.test($("#app").textContent));
  // restore download-only behavior for the remaining checks
  delete window.navigator.share;
  delete window.navigator.canShare;

  // switch to a fresh second account
  click('[data-action="logout"]');
  await signIn("bob", "9999");
  check("second account starts without demo's custom machine", !/Smith Machine/.test($("#app").textContent));

  // restore demo's backup into bob
  click('[data-action="open-settings"]');
  const input = $("#input-restore");
  const file = new window.File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(50);
  check("restore reports success", /BACKUP RESTORED/.test($("#app").textContent));
  check("restore persisted under bob", /Smith Machine/.test(JSON.stringify(accounts.bob || {})));
  click('[data-action="go-home"]');
  check("restored machine visible on home", /Smith Machine/.test($("#app").textContent));

  // reject a non-backup file
  click('[data-action="open-settings"]');
  const input2 = $("#input-restore"); // fresh node after re-render
  const bad = new window.File(["not json at all"], "x.json", { type: "application/json" });
  Object.defineProperty(input2, "files", { value: [bad], configurable: true });
  input2.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(50);
  check("invalid file rejected", /INVALID FILE/.test($("#app").textContent));

  // delete account
  click('[data-action="delete-account"]');
  await wait(20);
  check("delete returns to login", /FORGE/.test($("#app").textContent));
  check("deleted account removed from storage", accounts.bob === undefined);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
