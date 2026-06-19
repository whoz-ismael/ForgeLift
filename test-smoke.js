// Headless smoke test for the ForgeLift app using jsdom.
const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("js/app.js", "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://localhost/" });
const { window } = dom;
const { document } = window;
const store = window.localStorage; // jsdom-backed; usable because url is set

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

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

console.log("LOGIN");
check("login screen rendered", /FORGE/.test($("#app").textContent));
setInput("#input-username", "demo");
"1234".split("").forEach((d) => click('[data-action="pin"][data-d="' + d + '"]'));
check("4 pin dots filled", $("#app").innerHTML.split("background:var(--accent);").length >= 5);
click('[data-action="do-login"]');

console.log("HOME");
check("home shows MACHINES", /MACHINES/.test($("#app").textContent));
check("seeded machines present (Chest Press)", /Chest Press/.test($("#app").textContent));
check("favorites group shown", /Favorites/.test($("#app").textContent));

console.log("SEARCH");
setInput("#input-search", "leg");
check("search filters to leg machines", /Leg Press/.test($("#app").textContent) && !/Chest Press/.test($("#app").textContent));
setInput("#input-search", "");

console.log("MACHINE DETAIL + LOG A SET");
click('[data-action="open-machine"][data-id="m0"]'); // Chest Press
check("machine detail shows Personal Best", /Personal Best/.test($("#app").textContent));
check("chart rendered (polyline)", !!$("polyline"));
click('[data-action="add-set"]');
check("a draft set appears", /SET 01/.test($("#app").textContent));
const repsBefore = $('[data-action="rep-up"]').parentElement.querySelector("span").textContent;
click('[data-action="rep-up"]');
const repsAfter = $('[data-action="rep-up"]').parentElement.querySelector("span").textContent;
check("rep + increments", Number(repsAfter) === Number(repsBefore) + 1);
click('[data-action="w-up"]');
check("save bar enabled", /Save Session/.test($("#app").textContent));
click('[data-action="save-session"]');
check("session saved (draft cleared)", !/SET 01/.test($("#app").textContent));
check("persisted to localStorage", !!store.getItem("replog:demo"));

console.log("ADD MACHINE");
click('[data-action="go-home"]');
click('[data-action="open-add"]');
check("new machine screen", /NEW MACHINE/.test($("#app").textContent));
setInput("#input-addname", "Smith Machine");
click('[data-action="pick-group"][data-g="Legs"]');
click('[data-action="save-machine"]');
check("new machine on home", /Smith Machine/.test($("#app").textContent));

console.log("SETTINGS");
click('[data-action="open-settings"]');
check("settings screen", /SETTINGS/.test($("#app").textContent));
click('[data-action="theme-light"]');
check("theme switched to light", $("#app").getAttribute("data-theme") === "light");
click('[data-action="unit-lb"]');
check("unit switched to lb", JSON.parse(store.getItem("replog:demo")).unit === "lb");
click('[data-action="logout"]');
check("logged out to login", /FORGE/.test($("#app").textContent));

console.log("\nRELOGIN PERSISTENCE");
setInput("#input-username", "demo");
"1234".split("").forEach((d) => click('[data-action="pin"][data-d="' + d + '"]'));
click('[data-action="do-login"]');
check("custom machine persisted across logout", /Smith Machine/.test($("#app").textContent));
check("theme persisted (light)", $("#app").getAttribute("data-theme") === "light");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
