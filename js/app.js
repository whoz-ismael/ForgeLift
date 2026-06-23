/* ForgeLift — vanilla JS gym tracker.
 * Ported faithfully from the Claude Design prototype (ForgeLift.dc.html).
 * State lives in memory; per-user data is persisted to Supabase Postgres
 * through window.ForgeLiftAuth (js/supabase.js), behind Supabase Auth. */
(function () {
  "use strict";

  var LB = 0.45359237;
  var MI = 1.609344; // kilometres per mile
  var GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio"];

  var state = {
    screen: "loading", theme: "dark", unit: "kg",
    user: null,                                  // { id, name, email }
    authMode: "signin",                          // "signin" | "signup"
    emailDraft: "", passwordDraft: "",
    loginError: "", loginNotice: "", busy: false,
    machines: [], logs: {}, activeId: null, draft: [], search: "",
    addName: "", addGroup: "Chest", addPhoto: null,
    settingsMsg: "", settingsMsgOk: false,
  };

  var app = document.getElementById("app");

  // ── helpers ──
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── machine kind ──
  // Cardio machines (treadmill, bike, rower, …) are logged by time/distance/
  // calories instead of reps/weight. We key off the group so the distinction
  // survives backups and custom-added machines.
  function isCardio(m) { return !!m && m.group === "Cardio"; }
  function activeIsCardio() {
    return isCardio(state.machines.find(function (m) { return m.id === state.activeId; }));
  }

  // ── seed data (demo account) ──
  function seed() {
    var base = [
      // Chest
      ["Chest Press", "Chest"], ["Incline Press", "Chest"], ["Decline Press", "Chest"],
      ["Pec Deck", "Chest"], ["Cable Crossover", "Chest"], ["Assisted Dip", "Chest"],
      // Back
      ["Lat Pulldown", "Back"], ["Seated Row", "Back"], ["T-Bar Row", "Back"], ["Machine Row", "Back"],
      ["Assisted Pull-Up", "Back"], ["Back Extension", "Back"], ["Lat Pullover", "Back"],
      // Legs
      ["Leg Press", "Legs"], ["Hack Squat", "Legs"], ["Leg Extension", "Legs"], ["Leg Curl", "Legs"],
      ["Calf Raise", "Legs"], ["Hip Abduction", "Legs"], ["Hip Adduction", "Legs"],
      ["Glute Kickback", "Legs"], ["Hip Thrust", "Legs"],
      // Shoulders
      ["Shoulder Press", "Shoulders"], ["Lateral Raise", "Shoulders"], ["Rear Delt Fly", "Shoulders"],
      ["Front Raise", "Shoulders"], ["Shrug", "Shoulders"], ["Upright Row", "Shoulders"],
      // Arms
      ["Bicep Curl", "Arms"], ["Preacher Curl", "Arms"], ["Cable Curl", "Arms"], ["Hammer Curl", "Arms"],
      ["Tricep Pushdown", "Arms"], ["Tricep Extension", "Arms"],
      // Core
      ["Ab Crunch", "Core"], ["Cable Crunch", "Core"], ["Rotary Torso", "Core"],
      ["Hanging Leg Raise", "Core"], ["Roman Chair", "Core"],
      // Cardio
      ["Treadmill", "Cardio"], ["Stationary Bike", "Cardio"], ["Recumbent Bike", "Cardio"],
      ["Spin Bike", "Cardio"], ["Elliptical", "Cardio"], ["Rowing Machine", "Cardio"],
      ["Stair Climber", "Cardio"], ["Air Bike", "Cardio"], ["Ski Erg", "Cardio"], ["Arc Trainer", "Cardio"],
    ];
    var machines = base.map(function (b, i) {
      return { id: "m" + i, name: b[0], group: b[1], fav: false, photo: null };
    });
    // Fresh accounts get the machine catalog only — no example history or
    // preset favorites. The user builds their own progress from here.
    return { machines: machines, logs: {} };
  }

  // ── persistence ──
  // Pushes the current profile snapshot to Supabase. Saves are chained so that
  // rapid edits land in order (last-write-wins on the user's row).
  var saveChain = Promise.resolve();
  function persist() {
    var u = state.user;
    if (!u) return;
    var snapshot = {
      machines: state.machines, logs: state.logs, unit: state.unit, theme: state.theme,
    };
    saveChain = saveChain
      .then(function () { return window.ForgeLiftAuth.saveProfile(u.id, snapshot); })
      .catch(function (e) { console.error("ForgeLift: save failed —", e && e.message); });
  }
  function setState(patch, persistAfter) {
    Object.assign(state, patch);
    if (persistAfter) persist();
    render();
  }

  // ── auth ──
  // The whole UI follows the Supabase session: onChange fires on first load and
  // on sign in / out. We load (or seed) the user's profile when a session
  // appears and drop back to the login screen when it goes.
  var sessionUserId = null;
  function boot() {
    if (!window.ForgeLiftAuth || !window.ForgeLiftAuth.ready) {
      setState({ screen: "login", loginError: "AUTH UNAVAILABLE — CHECK CONNECTION" });
      return;
    }
    window.ForgeLiftAuth.onChange(handleSession);
  }
  function handleSession(session) {
    var u = session && session.user;
    if (u) {
      if (u.id === sessionUserId) return; // ignore token refreshes for the same user
      sessionUserId = u.id;
      var meta = u.user_metadata || {};
      var name = meta.full_name || meta.name ||
        (u.email ? u.email.split("@")[0] : "athlete");
      state.user = { id: u.id, name: name, email: u.email || "" };
      // Defer Supabase calls out of the auth callback (avoids client deadlocks).
      setTimeout(loadProfileThenHome, 0);
    } else {
      sessionUserId = null;
      setState({
        screen: "login", user: null, machines: [], logs: {}, activeId: null,
        draft: [], search: "", busy: false, authMode: "signin",
        passwordDraft: "", loginError: "", loginNotice: "",
        settingsMsg: "", settingsMsgOk: false,
      });
    }
  }
  function loadProfileThenHome() {
    window.ForgeLiftAuth.loadProfile().then(function (row) {
      if (row) {
        setState({
          machines: row.machines || [], logs: row.logs || {},
          unit: row.unit || state.unit, theme: row.theme || state.theme,
          screen: "home", busy: false, emailDraft: "", passwordDraft: "",
          loginError: "", loginNotice: "",
        });
      } else {
        // First sign-in for this user — seed the catalog and create the row.
        var data = seed();
        setState({
          machines: data.machines, logs: data.logs, screen: "home", busy: false,
          emailDraft: "", passwordDraft: "", loginError: "", loginNotice: "",
        }, true);
      }
    }).catch(function (e) {
      console.error("ForgeLift: profile load failed —", e && e.message);
      setState({ screen: "login", busy: false, loginError: "COULD NOT LOAD YOUR DATA" });
    });
  }

  function submitEmail() {
    if (state.busy) return;
    var email = state.emailDraft.trim();
    var pw = state.passwordDraft;
    var signup = state.authMode === "signup";
    if (!email || email.indexOf("@") < 0) { setState({ loginError: "ENTER A VALID EMAIL" }); return; }
    if (pw.length < 6) { setState({ loginError: "PASSWORD NEEDS 6+ CHARACTERS" }); return; }
    setState({ busy: true, loginError: "", loginNotice: "" });
    var call = signup
      ? window.ForgeLiftAuth.signUpEmail(email, pw)
      : window.ForgeLiftAuth.signInEmail(email, pw);
    call.then(function (res) {
      if (res && res.error) { setState({ busy: false, loginError: authError(res.error) }); return; }
      // Sign-up with email confirmation on → no session yet; tell the user.
      if (signup && res && res.data && !res.data.session) {
        setState({ busy: false, loginError: "", loginNotice: "CHECK YOUR EMAIL TO CONFIRM, THEN SIGN IN", authMode: "signin", passwordDraft: "" });
        return;
      }
      // Otherwise the session arrives via onChange, which navigates home.
    }).catch(function (e) {
      console.error("ForgeLift: email auth failed —", e && e.message);
      setState({ busy: false, loginError: "CONNECTION ERROR" });
    });
  }
  function authError(err) {
    var m = (err && err.message ? err.message : "").toLowerCase();
    if (m.indexOf("invalid login") >= 0) return "WRONG EMAIL OR PASSWORD";
    if (m.indexOf("already registered") >= 0 || m.indexOf("already exists") >= 0) return "EMAIL ALREADY REGISTERED — SIGN IN";
    if (m.indexOf("not confirmed") >= 0) return "CONFIRM YOUR EMAIL FIRST";
    if (m.indexOf("password") >= 0) return "PASSWORD NEEDS 6+ CHARACTERS";
    return (err && err.message ? err.message.toUpperCase() : "SOMETHING WENT WRONG");
  }
  function toggleAuthMode() {
    setState({ authMode: state.authMode === "signin" ? "signup" : "signin", loginError: "", loginNotice: "" });
  }

  // ── passkeys (WebAuthn) ──
  function passkeysAvailable() {
    return !!(window.ForgeLiftAuth && window.ForgeLiftAuth.passkeysSupported && window.PublicKeyCredential);
  }
  function passkeyError(err) {
    var name = (err && err.name) || "";
    var m = (err && err.message ? err.message : "").toLowerCase();
    if (name === "NotAllowedError" || m.indexOf("cancel") >= 0 || m.indexOf("not allowed") >= 0) return "PASSKEY CANCELLED";
    if (m.indexOf("no ") >= 0 && m.indexOf("passkey") >= 0) return "NO PASSKEY ON THIS DEVICE — SIGN IN WITH EMAIL FIRST";
    if (m.indexOf("not enabled") >= 0 || m.indexOf("disabled") >= 0) return "PASSKEYS NOT ENABLED FOR THIS PROJECT";
    return "PASSKEY SIGN-IN FAILED";
  }
  function authPasskey() {
    if (state.busy) return;
    setState({ busy: true, loginError: "", loginNotice: "" });
    window.ForgeLiftAuth.signInPasskey().then(function (res) {
      if (res && res.error) { setState({ busy: false, loginError: passkeyError(res.error) }); return; }
      // Success → onChange delivers the session and navigates home.
    }).catch(function (e) {
      setState({ busy: false, loginError: passkeyError(e) });
    });
  }
  function addPasskey() {
    setState({ settingsMsg: "ADDING PASSKEY…", settingsMsgOk: true });
    window.ForgeLiftAuth.registerPasskey().then(function (res) {
      if (res && res.error) { setState({ settingsMsg: passkeyError(res.error), settingsMsgOk: false }); return; }
      setState({ settingsMsg: "PASSKEY ADDED ✓ — USE IT NEXT TIME YOU SIGN IN", settingsMsgOk: true });
    }).catch(function (e) {
      setState({ settingsMsg: passkeyError(e), settingsMsgOk: false });
    });
  }

  function logout() {
    // Reset the UI immediately; onChange will also fire from signOut().
    setState({
      screen: "login", user: null, machines: [], logs: {}, activeId: null,
      draft: [], search: "", busy: false, authMode: "signin",
      passwordDraft: "", emailDraft: "", loginError: "", loginNotice: "",
      settingsMsg: "", settingsMsgOk: false,
    });
    sessionUserId = null;
    if (window.ForgeLiftAuth) {
      window.ForgeLiftAuth.signOut().catch(function (e) {
        console.error("ForgeLift: sign out failed —", e && e.message);
      });
    }
  }

  // ── nav ──
  function openSettings() { setState({ screen: "settings", settingsMsg: "", settingsMsgOk: false }); }
  function openAdd() { setState({ screen: "add", addName: "", addPhoto: null, addGroup: "Chest" }); }
  function goHome() { setState({ screen: "home", search: "", settingsMsg: "", settingsMsgOk: false }); }
  function openMachine(id) { setState({ activeId: id, draft: [], screen: "machine" }); }

  // ── favorites ──
  function toggleFav(id) {
    setState({ machines: state.machines.map(function (m) {
      return m.id === id ? Object.assign({}, m, { fav: !m.fav }) : m;
    }) }, true);
  }

  // ── set drafting ──
  function lastWeight(id) {
    var s = state.logs[id] || [];
    if (!s.length) return 20;
    var l = s[s.length - 1];
    return Math.max.apply(null, l.sets.map(function (x) { return x.weight; }));
  }
  function lastCardio(id) {
    var s = state.logs[id] || [];
    if (!s.length) return { duration: 20, distance: 0, calories: 0 };
    var l = s[s.length - 1], last = l.sets[l.sets.length - 1] || {};
    return { duration: last.duration || 20, distance: last.distance || 0, calories: last.calories || 0 };
  }
  function addSet() {
    if (activeIsCardio()) { setState({ draft: state.draft.concat([lastCardio(state.activeId)]) }); }
    else { setState({ draft: state.draft.concat([{ reps: 10, weight: lastWeight(state.activeId) }]) }); }
  }
  function duplicateLast() {
    var d = state.draft;
    if (!d.length) { addSet(); return; }
    setState({ draft: d.concat([Object.assign({}, d[d.length - 1])]) });
  }
  function repsDelta(i, dl) {
    setState({ draft: state.draft.map(function (s, j) {
      return j === i ? Object.assign({}, s, { reps: Math.max(1, s.reps + dl) }) : s;
    }) });
  }
  function weightDelta(i, dl) {
    var step = state.unit === "lb" ? 5 * LB : 2.5;
    setState({ draft: state.draft.map(function (s, j) {
      return j === i ? Object.assign({}, s, { weight: Math.max(0, Math.round((s.weight + dl * step) * 1000) / 1000) }) : s;
    }) });
  }
  function durationDelta(i, dl) {
    setState({ draft: state.draft.map(function (s, j) {
      return j === i ? Object.assign({}, s, { duration: Math.max(1, (s.duration || 0) + dl) }) : s;
    }) });
  }
  function distanceDelta(i, dl) {
    var step = state.unit === "lb" ? 0.1 * MI : 0.1; // 0.1 mi / 0.1 km per tap
    setState({ draft: state.draft.map(function (s, j) {
      return j === i ? Object.assign({}, s, { distance: Math.max(0, Math.round(((s.distance || 0) + dl * step) * 1000) / 1000) }) : s;
    }) });
  }
  function caloriesDelta(i, dl) {
    setState({ draft: state.draft.map(function (s, j) {
      return j === i ? Object.assign({}, s, { calories: Math.max(0, (s.calories || 0) + dl * 10) }) : s;
    }) });
  }
  function removeSet(i) { setState({ draft: state.draft.filter(function (_, j) { return j !== i; }) }); }
  function saveSession() {
    var id = state.activeId, d = state.draft;
    if (!d.length) return;
    var cardio = activeIsCardio();
    var today = new Date().toISOString().slice(0, 10);
    var logs = Object.assign({}, state.logs);
    logs[id] = (logs[id] || []).concat([{ date: today, sets: d.map(function (s) {
      return cardio
        ? { duration: s.duration || 0, distance: s.distance || 0, calories: s.calories || 0 }
        : { reps: s.reps, weight: s.weight };
    }) }]);
    setState({ logs: logs, draft: [] }, true);
  }

  // ── add machine ──
  function handlePhoto(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () { setState({ addPhoto: r.result }); };
    r.readAsDataURL(file);
  }
  function saveMachine() {
    var n = state.addName.trim();
    if (!n) return;
    var m = { id: "c" + Date.now(), name: n, group: state.addGroup, fav: false, photo: state.addPhoto };
    setState({ machines: state.machines.concat([m]), addName: "", addPhoto: null, screen: "home" }, true);
  }

  // ── settings ──
  function setTheme(t) { setState({ theme: t }, true); }
  function setUnit(u) { setState({ unit: u }, true); }

  // ── backup / restore / delete ──
  function sanitizeMachines(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (m) { return m && m.name != null; }).map(function (m, i) {
      return {
        id: String(m.id || ("r" + Date.now() + "_" + i)),
        name: String(m.name),
        group: GROUPS.indexOf(m.group) >= 0 ? m.group : (m.group ? String(m.group) : "Chest"),
        fav: !!m.fav,
        photo: typeof m.photo === "string" ? m.photo : null,
      };
    });
  }
  function sanitizeLogs(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var arr = obj[k];
      if (!Array.isArray(arr)) return;
      var sessions = arr.map(function (s) {
        var sets = Array.isArray(s && s.sets)
          ? s.sets.map(function (x) {
              if (x && (x.duration != null || x.distance != null || x.calories != null)) {
                return { duration: Number(x.duration) || 0, distance: Number(x.distance) || 0, calories: Number(x.calories) || 0 };
              }
              return { reps: Number(x && x.reps) || 0, weight: Number(x && x.weight) || 0 };
            })
            .filter(function (x) { return x.reps || x.weight || x.duration || x.distance || x.calories; })
          : [];
        return { date: String((s && s.date) || ""), sets: sets };
      }).filter(function (s) { return s.sets.length; });
      if (sessions.length) out[k] = sessions;
    });
    return out;
  }

  function downloadBackup(json, filename) {
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  }

  function exportBackup() {
    var json, filename;
    try {
      var who = state.user ? (state.user.email || state.user.name) : "backup";
      var payload = {
        app: "ForgeLift", version: 1, user: who, exportedAt: new Date().toISOString(),
        data: { machines: state.machines, logs: state.logs, unit: state.unit, theme: state.theme },
      };
      json = JSON.stringify(payload, null, 2);
      var slug = who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "backup";
      filename = "forgelift-" + slug + "-" + new Date().toISOString().slice(0, 10) + ".json";
    } catch (e) {
      setState({ settingsMsg: "EXPORT FAILED", settingsMsgOk: false });
      return;
    }

    // Preferred path (iPhone/iPad): open the iOS share sheet so the user can
    // pick "Save to Files" → iCloud Drive, which Apple then syncs across devices.
    try {
      if (navigator.share && navigator.canShare) {
        var file = new File([json], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "ForgeLift backup" })
            .then(function () { setState({ settingsMsg: "BACKUP SHARED · SAVE TO FILES FOR iCLOUD", settingsMsgOk: true }); })
            .catch(function (err) {
              if (err && err.name === "AbortError") {
                setState({ settingsMsg: "EXPORT CANCELLED", settingsMsgOk: false });
              } else {
                downloadBackup(json, filename);
                setState({ settingsMsg: "BACKUP DOWNLOADED", settingsMsgOk: true });
              }
            });
          return;
        }
      }
    } catch (e) { /* fall through to plain download */ }

    // Fallback (desktop / Android / unsupported): normal file download.
    try {
      downloadBackup(json, filename);
      setState({ settingsMsg: "BACKUP DOWNLOADED", settingsMsgOk: true });
    } catch (e) {
      setState({ settingsMsg: "EXPORT FAILED", settingsMsgOk: false });
    }
  }

  function importBackup(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var parsed;
      try { parsed = JSON.parse(r.result); } catch (e) {
        setState({ settingsMsg: "INVALID FILE — NOT JSON", settingsMsgOk: false }); return;
      }
      var d = parsed && parsed.data ? parsed.data : parsed; // accept full backup or raw data
      if (!d || !Array.isArray(d.machines)) {
        setState({ settingsMsg: "NOT A FORGELIFT BACKUP", settingsMsgOk: false }); return;
      }
      if (!window.confirm("Restore this backup? It replaces the current machines and history for \"" + ((state.user && state.user.name) || "this account") + "\".")) {
        setState({ settingsMsg: "RESTORE CANCELLED", settingsMsgOk: false }); return;
      }
      var machines = sanitizeMachines(d.machines);
      var logs = sanitizeLogs(d.logs);
      var unit = d.unit === "lb" ? "lb" : "kg";
      var theme = d.theme === "light" ? "light" : "dark";
      setState({ machines: machines, logs: logs, unit: unit, theme: theme, settingsMsg: "BACKUP RESTORED · " + machines.length + " MACHINES", settingsMsgOk: true }, true);
    };
    r.onerror = function () { setState({ settingsMsg: "COULD NOT READ FILE", settingsMsgOk: false }); };
    r.readAsText(file);
  }

  function deleteAccount() {
    var u = state.user;
    if (!u) return;
    if (!window.confirm("Erase all workout data for \"" + u.email + "\"? This wipes your machines and history and cannot be undone. You'll be signed out.")) return;
    window.ForgeLiftAuth.deleteProfile(u.id).then(function () {
      logout();
    }).catch(function (e) {
      console.error("ForgeLift: delete failed —", e && e.message);
      setState({ settingsMsg: "DELETE FAILED — CONNECTION ERROR", settingsMsgOk: false });
    });
  }

  // ── formatting ──
  function dispW(kg) { return state.unit === "lb" ? Math.round(kg / LB) : Math.round(kg * 10) / 10; }
  function distUnit() { return state.unit === "lb" ? "mi" : "km"; }
  function dispDist(km) { return Math.round((state.unit === "lb" ? km / MI : km) * 100) / 100; }
  function sumField(session, f) { return session.sets.reduce(function (a, x) { return a + (x[f] || 0); }, 0); }
  function fmtPace(minPerUnit) {
    if (!isFinite(minPerUnit) || minPerUnit <= 0) return "—";
    var m = Math.floor(minPerUnit), s = Math.round((minPerUnit - m) * 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ":" + String(s).padStart(2, "0");
  }
  function fmtDate(iso) {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase();
    } catch (e) { return iso; }
  }

  // ── icon resolution ──
  function iconKey(name, group) {
    var n = (name || "").toLowerCase();
    if (group === "Cardio") {
      if (n.includes("tread") || n.includes("run")) return "run";
      if (n.includes("bike") || n.includes("cycl") || n.includes("spin")) return "bike";
      if (n.includes("row") || n.includes("erg") || n.includes("ski")) return "rower";
      if (n.includes("stair") || n.includes("step") || n.includes("climb") || n.includes("ladder")) return "stairs";
      return "cardio";
    }
    if (n.includes("pulldown")) return "pulldown";
    if (n.includes("pull-up") || n.includes("pull up") || n.includes("pullup") || n.includes("chin")) return "pullup";
    if (n.includes("row")) return "row";
    if (n.includes("crossover") || n.includes("pec deck") || n.includes("fly")) return "fly";
    if (n.includes("lateral") || n.includes("lat raise")) return "lateral";
    if (n.includes("leg") && n.includes("curl")) return "legcurl";
    if (n.includes("leg press")) return "legpress";
    if (n.includes("leg") && n.includes("ext")) return "legext";
    if (n.includes("back ext") || n.includes("hyperext")) return "backext";
    if (n.includes("squat")) return "squat";
    if (n.includes("calf")) return "calf";
    if (n.includes("pushdown") || n.includes("tricep")) return "pushdown";
    if (n.includes("curl")) return "curl";
    if (n.includes("crunch") || n.includes("ab ")) return "crunch";
    if (n.includes("press")) return "press";
    var g = { Chest: "press", Back: "pulldown", Legs: "legpress", Shoulders: "lateral", Arms: "curl", Core: "crunch" };
    return g[group] || "press";
  }

  function brandMark(c, a) {
    var cell = 56, R = 25, sx = 512 - 6 * cell, sy = 512 - 4 * cell;
    var dots = [];
    var add = function (col, row, red) { dots.push([col, row, red]); };
    for (var col = 3; col <= 9; col++) add(col, 4, col === 6);
    [3, 9].forEach(function (c2) { add(c2, 3); add(c2, 5); });
    [2, 10].forEach(function (c2) { [2, 3, 4, 5, 6].forEach(function (row) { add(c2, row); }); });
    [1, 11].forEach(function (c2) { for (var row = 1; row <= 7; row++) add(c2, row); });
    var circ = dots.map(function (d) {
      return '<circle cx="' + (sx + d[0] * cell) + '" cy="' + (sy + d[1] * cell) + '" r="' + R + '" fill="' + (d[2] ? a : c) + '"/>';
    }).join("");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">' + circ + "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function machineIcon(name, group, c, a) {
    var W = 'fill="' + a + '" stroke="none"';
    var P = {
      press: '<circle cx="20" cy="9" r="2.6"/><path d="M20 12v9"/><path d="M20 21l-4 8"/><path d="M20 21l4 8"/><path d="M20 14l-6-3"/><path d="M20 14l6-3"/><path d="M11 11h18"/><circle cx="11" cy="11" r="2.4" ' + W + '/><circle cx="29" cy="11" r="2.4" ' + W + '/>',
      curl: '<circle cx="18" cy="9" r="2.6"/><path d="M18 12v10"/><path d="M18 22l-4 7"/><path d="M18 22l4 7"/><path d="M18 14l4 5"/><path d="M22 19l-3-4"/><circle cx="19" cy="14.5" r="2.4" ' + W + '/>',
      lateral: '<circle cx="20" cy="9" r="2.6"/><path d="M20 12v10"/><path d="M20 22l-4 7"/><path d="M20 22l4 7"/><path d="M20 14h-9"/><path d="M20 14h9"/><circle cx="10" cy="14" r="2.4" ' + W + '/><circle cx="30" cy="14" r="2.4" ' + W + '/>',
      fly: '<circle cx="20" cy="9" r="2.6"/><path d="M20 12v10"/><path d="M20 22l-4 7"/><path d="M20 22l4 7"/><path d="M20 14c-6 0-9 2-9 6"/><path d="M20 14c6 0 9 2 9 6"/><circle cx="11" cy="20" r="2.4" ' + W + '/><circle cx="29" cy="20" r="2.4" ' + W + '/>',
      pulldown: '<path d="M12 7h16"/><circle cx="12" cy="7" r="2.2" ' + W + '/><circle cx="28" cy="7" r="2.2" ' + W + '/><circle cx="20" cy="15" r="2.6"/><path d="M20 18v6"/><path d="M20 18l-5-9"/><path d="M20 18l5-9"/><path d="M20 24l-4 6"/><path d="M20 24l5 3v3"/>',
      row: '<path d="M30 7v25"/><circle cx="15" cy="12" r="2.6"/><path d="M15 15v6"/><path d="M15 21h7l3 8"/><path d="M15 16h9"/><circle cx="24" cy="16" r="2.4" ' + W + '/><path d="M26 16h4"/>',
      pullup: '<path d="M9 8h22"/><path d="M16 8v3"/><path d="M24 8v3"/><circle cx="20" cy="14" r="2.6"/><path d="M16 11l4 3 4-3"/><path d="M20 17v8"/><path d="M20 25l-3 6"/><path d="M20 25l3 6"/>',
      backext: '<path d="M7 31l12-7"/><circle cx="16" cy="18" r="2.6"/><path d="M16 21l8 5"/><path d="M24 26l6-2"/><path d="M16 21l-3 8"/><circle cx="30" cy="24" r="2.4" ' + W + '/>',
      legpress: '<path d="M8 30v-7a2 2 0 0 1 2-2h3"/><path d="M8 30h8"/><circle cx="12" cy="17" r="2.5"/><path d="M14 21l10-6"/><path d="M24 15l5-3"/><path d="M26 8l6 4-4 6z" ' + W + '/>',
      legext: '<path d="M10 13v11"/><path d="M10 24h6"/><circle cx="13" cy="10" r="2.4"/><path d="M16 24h5"/><path d="M21 24l8-3"/><circle cx="29" cy="21" r="2.4" ' + W + '/>',
      legcurl: '<path d="M7 27h16"/><circle cx="11" cy="22.5" r="2.4"/><path d="M13 24h9"/><path d="M22 24l3-7"/><circle cx="25" cy="17" r="2.4" ' + W + '/>',
      squat: '<circle cx="20" cy="9" r="2.6"/><path d="M20 12v6"/><path d="M13 12h14"/><circle cx="13" cy="12" r="2.2" ' + W + '/><circle cx="27" cy="12" r="2.2" ' + W + '/><path d="M20 18l-5 5v6"/><path d="M20 18l5 5v6"/>',
      calf: '<circle cx="20" cy="9" r="2.6"/><path d="M20 12v13"/><path d="M14 12h12"/><circle cx="14" cy="12" r="2.2" ' + W + '/><circle cx="26" cy="12" r="2.2" ' + W + '/><path d="M20 25l-4 5"/><path d="M20 25l4 5"/><path d="M14 30h12"/>',
      pushdown: '<path d="M12 7h16"/><circle cx="20" cy="9.5" r="2.6"/><path d="M20 12.5v8"/><path d="M20 20.5l-4 7"/><path d="M20 20.5l4 7"/><path d="M20 15l-4 4v4"/><path d="M16 9.5v5.5"/><circle cx="16" cy="23" r="2.4" ' + W + '/>',
      crunch: '<path d="M7 29h18"/><path d="M20 28l3-5"/><path d="M20 28l-6-4"/><circle cx="12" cy="20" r="2.6"/><path d="M14 22l5 5"/><path d="M14 21l5-1"/>',
      run: '<circle cx="20" cy="8" r="2.6"/><path d="M20 11l-2 7"/><path d="M20 13l5-1"/><path d="M20 13l-4 3"/><path d="M18 18l5 4"/><path d="M18 18l-4 7"/><path d="M6 31h28"/>',
      bike: '<circle cx="11" cy="28" r="4.5"/><circle cx="29" cy="28" r="4.5"/><path d="M11 28h9l4-11 5 11"/><path d="M19 17h6"/><path d="M25 17l3-3"/>',
      rower: '<path d="M6 30h28"/><circle cx="9" cy="25" r="3.5"/><path d="M12 25h7"/><path d="M19 25l7-4"/><path d="M26 21v-3"/><path d="M24 18h4"/>',
      stairs: '<path d="M7 31h7v-6h7v-6h7v-6h5"/>',
      cardio: '<path d="M4 20h7l2-4 3 9 2-5h18"/>',
    }[iconKey(name, group)];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" stroke="' + c + '" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + P + "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // ════════════════════════ RENDER ════════════════════════
  function render() {
    var isDark = state.theme === "dark";
    app.setAttribute("data-theme", isDark ? "dark" : "light");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isDark ? "#000000" : "#f4f4f2");

    var iconStroke = isDark ? "#d6d6d6" : "#3a3a3a";
    var iconAccent = "#D71921";
    var ul = state.unit;

    var html = "";
    if (state.screen === "loading") html = viewLoading(isDark, iconAccent);
    else if (state.screen === "login") html = viewLogin(isDark, iconAccent);
    else if (state.screen === "home") html = viewHome(ul, iconStroke, iconAccent);
    else if (state.screen === "machine") html = viewMachine(ul);
    else if (state.screen === "add") html = viewAdd();
    else if (state.screen === "settings") html = viewSettings(isDark, ul);

    // preserve focus + caret across full re-render
    var act = document.activeElement;
    var focusId = act && act.id && app.contains(act) ? act.id : null;
    var selStart = focusId ? act.selectionStart : null;
    var selEnd = focusId ? act.selectionEnd : null;

    app.innerHTML = html;

    if (focusId) {
      var nx = document.getElementById(focusId);
      if (nx) {
        nx.focus();
        try { if (selStart != null) nx.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }

  // ── LOADING (checking the session) ──
  function viewLoading(isDark, iconAccent) {
    var mark = brandMark(isDark ? "#f3f3f1" : "#111111", iconAccent);
    return '<div class="screen" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:22px 22px;">' +
        '<img src="' + mark + '" alt="ForgeLift" style="width:56px;height:56px;display:block;opacity:0.9;" />' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:var(--accent);display:inline-block;animation:rl-blink 1.2s infinite;"></span>' +
          '<span style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:var(--muted);">Loading</span>' +
        '</div>' +
      '</div>';
  }

  // ── LOGIN (Supabase Auth: email + password) ──
  function viewLogin(isDark, iconAccent) {
    var mark = brandMark(isDark ? "#f3f3f1" : "#111111", iconAccent);
    var signup = state.authMode === "signup";
    var submitLabel = state.busy ? "···" : (signup ? "Create account →" : "Sign in →");

    var feedback = state.loginError
      ? '<div style="min-height:16px;margin-top:12px;font-size:11px;letter-spacing:0.06em;color:var(--accent);text-align:center;">' + esc(state.loginError) + '</div>'
      : (state.loginNotice
        ? '<div style="min-height:16px;margin-top:12px;font-size:11px;letter-spacing:0.06em;color:var(--muted);text-align:center;">' + esc(state.loginNotice) + '</div>'
        : '<div style="min-height:16px;margin-top:12px;"></div>');

    var inputStyle = "width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:16px;padding:14px 16px;outline:none;border-radius:4px;letter-spacing:0.02em;margin-bottom:10px;";

    return '<div class="screen" style="display:flex;flex-direction:column;background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:22px 22px;">' +
      '<div style="flex:1;overflow:auto;display:flex;flex-direction:column;justify-content:center;padding:48px 30px 40px;">' +
        '<img src="' + mark + '" alt="ForgeLift" style="width:54px;height:54px;display:block;margin-bottom:20px;" />' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:var(--accent);display:inline-block;animation:rl-blink 2.4s infinite;"></span>' +
          '<span style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:var(--muted);">Gym Tracker</span>' +
        '</div>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:50px;line-height:0.92;letter-spacing:0.01em;color:var(--text);margin-bottom:22px;">FORGE<br>LIFT</div>' +

        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;">' + (signup ? "Create your account" : "Sign in to continue") + '</div>' +

        '<input id="input-email" type="email" value="' + esc(state.emailDraft) + '" placeholder="email" autocomplete="email" inputmode="email" style="' + inputStyle + '" />' +
        '<input id="input-password" type="password" value="' + esc(state.passwordDraft) + '" placeholder="password" autocomplete="' + (signup ? "new-password" : "current-password") + '" style="' + inputStyle + 'margin-bottom:0;" />' +

        feedback +

        '<button data-action="auth-email" class="hov-bright" ' + (state.busy ? "disabled " : "") + 'style="width:100%;margin-top:10px;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:' + (state.busy ? "default" : "pointer") + ';">' + submitLabel + '</button>' +

        (passkeysAvailable()
          ? '<button data-action="auth-passkey" class="hov-border-accent" ' + (state.busy ? "disabled " : "") + 'style="width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:9px;background:transparent;border:1px solid var(--border);color:var(--text);font-weight:700;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:' + (state.busy ? "default" : "pointer") + ';">' + passkeyIcon() + 'Sign in with a passkey</button>'
          : '') +

        '<div style="text-align:center;margin-top:16px;font-size:11px;letter-spacing:0.04em;color:var(--muted);">' +
          (signup ? "Already have an account? " : "New here? ") +
          '<a data-action="auth-toggle" style="color:var(--text);cursor:pointer;text-decoration:underline;text-underline-offset:3px;">' +
          (signup ? "Sign in" : "Create one") + '</a>' +
        '</div>' +
      '</div></div>';
  }

  // Small monochrome fingerprint mark for the passkey buttons.
  function passkeyIcon() {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">' +
      '<path d="M12 10v3a8 8 0 0 1-1.5 4.7"/>' +
      '<path d="M8.5 8.6a5 5 0 0 1 7.5 4.3v.6"/>' +
      '<path d="M5.5 7a8 8 0 0 1 12.9 6"/>' +
      '<path d="M8 20.5a11 11 0 0 0 1.5-2.5"/>' +
      '<path d="M16 18a13 13 0 0 0 .9-5"/>' +
      '<path d="M12 13v.5a13 13 0 0 1-1.2 5.5"/>' +
      '</svg>';
  }

  // ── HOME ──
  function viewHome(ul, iconStroke, iconAccent) {
    var q = state.search.trim().toLowerCase();
    var filt = state.machines.filter(function (m) { return !q || m.name.toLowerCase().includes(q); });

    var mkRow = function (m) {
      var sess = state.logs[m.id] || [];
      var last = sess.length ? sess[sess.length - 1] : null;
      var detail = "—";
      if (last) {
        if (isCardio(m)) {
          var dist = sumField(last, "distance");
          detail = dist > 0 ? dispDist(dist) + " " + distUnit() : sumField(last, "duration") + " min";
        } else {
          detail = dispW(Math.max.apply(null, last.sets.map(function (s) { return s.weight; }))) + " " + ul;
        }
      }
      var thumb = m.photo
        ? '<img src="' + esc(m.photo) + '" style="width:42px;height:42px;border-radius:4px;object-fit:cover;flex-shrink:0;border:1px solid var(--border);" />'
        : '<div style="width:42px;height:42px;border-radius:4px;flex-shrink:0;border:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:center;padding:5px;box-sizing:border-box;"><img src="' + machineIcon(m.name, m.group, iconStroke, iconAccent) + '" style="width:100%;height:100%;object-fit:contain;display:block;" /></div>';
      var favDot = m.fav
        ? '<span style="width:16px;height:16px;border-radius:50%;background:var(--accent);"></span>'
        : '<span style="width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border);"></span>';
      return '<div data-action="open-machine" data-id="' + esc(m.id) + '" style="display:flex;align-items:center;gap:13px;padding:13px 0;border-bottom:1px solid var(--border);cursor:pointer;">' +
        thumb +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:15px;color:var(--text);letter-spacing:0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(m.name) + '</div>' +
          '<div style="font-size:10px;letter-spacing:0.12em;color:var(--muted);text-transform:uppercase;margin-top:2px;">Last · ' + esc(detail) + '</div>' +
        '</div>' +
        '<button data-action="toggle-fav" data-id="' + esc(m.id) + '" style="width:34px;height:34px;flex-shrink:0;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + favDot + '</button>' +
      '</div>';
    };

    var groups = [];
    var favs = filt.filter(function (m) { return m.fav; });
    if (favs.length) groups.push({ group: "Favorites", count: favs.length, items: favs });
    GROUPS.forEach(function (g) {
      var items = filt.filter(function (m) { return m.group === g; });
      if (items.length) groups.push({ group: g, count: items.length, items: items });
    });
    filt.forEach(function (m) {
      if (GROUPS.indexOf(m.group) === -1) {
        var grp = groups.find(function (x) { return x.group === m.group; });
        if (!grp) { grp = { group: m.group, count: 0, items: [] }; groups.push(grp); }
        grp.items.push(m); grp.count = grp.items.length;
      }
    });

    var listHtml = groups.map(function (g) {
      return '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;">' +
          '<span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text);">' + esc(g.group) + '</span>' +
          '<span style="font-size:10px;color:var(--muted);">' + g.count + '</span>' +
          '<span style="flex:1;height:1px;background:var(--border);"></span>' +
        '</div>' + g.items.map(mkRow).join("");
    }).join("");
    if (!groups.length) {
      listHtml = '<div style="text-align:center;padding:50px 0;font-size:12px;letter-spacing:0.1em;color:var(--muted);">NO MACHINES FOUND</div>';
    }

    var greeting = "Hello, " + ((state.user && state.user.name) || "").toUpperCase();

    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="padding:54px 22px 12px;flex-shrink:0;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;">' +
          '<div>' +
            '<div style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">' + esc(greeting) + '</div>' +
            '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:38px;line-height:0.95;color:var(--text);">MACHINES</div>' +
          '</div>' +
          '<button data-action="open-settings" class="hov-border-accent" style="width:42px;height:42px;flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"></path></svg>' +
          '</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0 14px;">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path></svg>' +
          '<input id="input-search" value="' + esc(state.search) + '" placeholder="SEARCH MACHINES" style="flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:13px;letter-spacing:0.08em;padding:13px 0;text-transform:uppercase;" />' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:6px 22px 110px;">' + listHtml + '</div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);">' +
        '<button data-action="open-add" class="hov-invert" style="width:100%;background:var(--text);border:none;color:var(--bg);font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">＋ Add Machine</button>' +
      '</div></div>';
  }

  // ── MACHINE DETAIL ──
  // A −/value/+ stepper. valueText is pre-formatted; actions carry data-i.
  function stepper(labelText, dnAction, upAction, i, valueText) {
    return '<div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">' + labelText + '</div>' +
      '<div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:4px;overflow:hidden;">' +
        '<button data-action="' + dnAction + '" data-i="' + i + '" class="hov-step" style="width:38px;height:42px;background:var(--bg);border:none;border-right:1px solid var(--border);color:var(--text);font-size:20px;cursor:pointer;">−</button>' +
        '<span style="flex:1;text-align:center;font-family:\'Doto\',monospace;font-weight:700;font-size:20px;color:var(--text);">' + valueText + '</span>' +
        '<button data-action="' + upAction + '" data-i="' + i + '" class="hov-step" style="width:38px;height:42px;background:var(--bg);border:none;border-left:1px solid var(--border);color:var(--text);font-size:20px;cursor:pointer;">+</button>' +
      '</div>';
  }
  function viewMachine(ul) {
    var am = state.machines.find(function (m) { return m.id === state.activeId; }) || null;
    var cardio = isCardio(am);
    var amName = "", amGroup = "", amFav = false;
    var pr = "—", cardioStats = [];
    var pbLabel = cardio ? "Longest Time" : "Personal Best";
    var pbUnit = cardio ? "min" : ul;
    var chartTitle = cardio ? "Duration · Over Time" : "Max Weight · Over Time";
    var setsTitle = cardio ? "Today's Session" : "Today's Sets";
    var chartHtml = '<div style="background:var(--surface);border:1px dashed var(--border);border-radius:6px;padding:34px 14px;text-align:center;font-size:11px;letter-spacing:0.1em;color:var(--muted);">NO DATA YET — LOG ' + (cardio ? "A SESSION" : "A SET") + ' BELOW</div>';
    var historyHtml = "";

    if (am) {
      amName = am.name; amGroup = am.group; amFav = am.fav;
      var sess = (state.logs[am.id] || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var sr = sess.map(function (s) { return { date: s.date, val: cardio ? sumField(s, "duration") : Math.max.apply(null, s.sets.map(function (x) { return x.weight; })) }; });
      if (sr.length) {
        var prVal = Math.max.apply(null, sr.map(function (s) { return s.val; }));
        pr = String(cardio ? prVal : dispW(prVal));
        var Wd = 300, H = 140, pL = 6, pR = 6, pT = 14, pB = 18;
        var vals = sr.map(function (s) { return s.val; });
        var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals), span = (mx - mn) || 1, n = sr.length;
        var coords = sr.map(function (s, i) {
          var x = n === 1 ? Wd / 2 : pL + (i / (n - 1)) * (Wd - pL - pR);
          var y = pT + (1 - (s.val - mn) / span) * (H - pT - pB);
          return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
        });
        var line = coords.map(function (c) { return c.x + "," + c.y; }).join(" ");
        var area = "M" + coords[0].x + "," + (H - pB) + coords.map(function (c) { return " L" + c.x + "," + c.y; }).join("") + " L" + coords[coords.length - 1].x + "," + (H - pB) + " Z";
        var dotsSvg = coords.map(function (d) {
          return '<circle cx="' + d.x + '" cy="' + d.y + '" r="3.2" style="fill:var(--surface);stroke:var(--accent);stroke-width:2;"></circle>';
        }).join("");
        chartHtml = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px 12px 8px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:2px;"><span>' + esc(cardio ? (mx + " min") : (dispW(mx) + " " + ul)) + '</span></div>' +
            '<svg viewBox="0 0 300 140" width="100%" style="display:block;overflow:visible;">' +
              '<path d="' + area + '" style="fill:var(--accent);fill-opacity:0.10;stroke:none;"></path>' +
              '<polyline points="' + line + '" style="fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;"></polyline>' +
              dotsSvg +
            '</svg>' +
            '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:2px;"><span>' + esc(fmtDate(sr[0].date)) + '</span><span>' + esc(fmtDate(sr[sr.length - 1].date)) + '</span></div>' +
          '</div>';
      }
      if (cardio) {
        if (sess.length) {
          var durs = sess.map(function (s) { return sumField(s, "duration"); });
          var farthestKm = Math.max.apply(null, sess.map(function (s) { return sumField(s, "distance"); }));
          cardioStats = [{ label: "Longest", val: String(Math.max.apply(null, durs)), unit: "min" }];
          if (farthestKm > 0) {
            var bestPace = null;
            sess.forEach(function (s) {
              var d = sumField(s, "duration"), km = sumField(s, "distance");
              if (km > 0) { var p = d / dispDist(km); if (bestPace === null || p < bestPace) bestPace = p; }
            });
            cardioStats.push({ label: "Farthest", val: String(dispDist(farthestKm)), unit: distUnit() });
            cardioStats.push({ label: "Best Pace", val: fmtPace(bestPace), unit: "/" + distUnit() });
          } else {
            cardioStats.push({ label: "Sessions", val: String(sess.length), unit: "" });
            cardioStats.push({ label: "Calories", val: String(sess.reduce(function (a, s) { return a + sumField(s, "calories"); }, 0)), unit: "kcal" });
          }
        } else {
          cardioStats = [{ label: "Longest", val: "—", unit: "min" }, { label: "Farthest", val: "—", unit: distUnit() }, { label: "Best Pace", val: "—", unit: "/" + distUnit() }];
        }
      }
      var hist = (state.logs[am.id] || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 8);
      if (hist.length) {
        historyHtml = '<div style="margin-top:28px;display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--text);">History</span>' +
            '<span style="flex:1;height:1px;background:var(--border);"></span>' +
          '</div>' +
          hist.map(function (s) {
            var bigNum, bigUnit, summary;
            if (cardio) {
              var dur = sumField(s, "duration"), dist = sumField(s, "distance"), cal = sumField(s, "calories");
              bigNum = String(dur); bigUnit = "min";
              var parts = [s.sets.length + (s.sets.length === 1 ? " INTERVAL" : " INTERVALS")];
              if (dist > 0) parts.push(dispDist(dist) + " " + distUnit());
              if (dist > 0 && dur > 0) parts.push(fmtPace(dur / dispDist(dist)) + " /" + distUnit());
              if (cal > 0) parts.push(cal + " KCAL");
              summary = parts.join(" · ");
            } else {
              bigNum = String(dispW(Math.max.apply(null, s.sets.map(function (x) { return x.weight; }))));
              bigUnit = ul;
              summary = s.sets.length + " SETS · " + s.sets.map(function (x) { return x.reps; }).join("/") + " REPS";
            }
            return '<div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);">' +
                '<div>' +
                  '<div style="font-size:12px;letter-spacing:0.1em;color:var(--text);">' + esc(fmtDate(s.date)) + '</div>' +
                  '<div style="font-size:10px;letter-spacing:0.06em;color:var(--muted);margin-top:3px;">' + esc(summary) + '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:baseline;gap:4px;"><span style="font-family:\'Doto\',monospace;font-weight:700;font-size:22px;color:var(--text);">' + esc(bigNum) + '</span><span style="font-size:10px;color:var(--muted);">' + esc(bigUnit) + '</span></div>' +
              '</div>';
          }).join("");
      }
    }

    var draftRows = state.draft.map(function (st, i) {
      var label = String(i + 1).padStart(2, "0");
      var entryLabel = cardio ? ("INTERVAL " + label) : ("SET " + label);
      var body;
      if (cardio) {
        body = '<div style="display:flex;gap:10px;">' +
            '<div style="flex:1;">' + stepper("Duration · min", "dur-dn", "dur-up", i, (st.duration || 0)) + '</div>' +
            '<div style="flex:1;">' + stepper("Distance · " + distUnit(), "dist-dn", "dist-up", i, dispDist(st.distance || 0)) + '</div>' +
          '</div>' +
          '<div style="margin-top:10px;">' + stepper("Calories · kcal", "cal-dn", "cal-up", i, (st.calories || 0)) + '</div>';
        var dDist = dispDist(st.distance || 0), dDur = (st.duration || 0);
        if (dDist > 0 && dDur > 0) {
          var pace = fmtPace(dDur / dDist) + " /" + distUnit();
          var speed = (Math.round((dDist / (dDur / 60)) * 10) / 10) + " " + distUnit() + "/h";
          body += '<div style="margin-top:12px;padding-top:11px;border-top:1px solid var(--border);display:flex;align-items:center;gap:9px;">' +
              '<span style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);">Pace</span>' +
              '<span style="font-family:\'Doto\',monospace;font-weight:700;font-size:17px;letter-spacing:0.04em;color:var(--accent);">' + esc(pace) + '</span>' +
              '<span style="flex:1;"></span>' +
              '<span style="font-size:11px;letter-spacing:0.06em;color:var(--muted);">' + esc(speed) + '</span>' +
            '</div>';
        }
      } else {
        body = '<div style="display:flex;gap:10px;">' +
            '<div style="flex:1;">' + stepper("Reps", "rep-dn", "rep-up", i, st.reps) + '</div>' +
            '<div style="flex:1.4;">' + stepper("Weight · " + esc(ul), "w-dn", "w-up", i, dispW(st.weight)) + '</div>' +
          '</div>';
      }
      return '<div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 13px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;">' +
            '<span style="font-family:\'Doto\',monospace;font-weight:700;font-size:15px;letter-spacing:0.1em;color:var(--text);">' + entryLabel + '</span>' +
            '<button data-action="remove-set" data-i="' + i + '" class="hov-accent-text" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:11px;letter-spacing:0.1em;">REMOVE</button>' +
          '</div>' + body + '</div>';
    }).join("");

    var amFavDot = amFav
      ? '<span style="width:16px;height:16px;border-radius:50%;background:var(--accent);"></span>'
      : '<span style="width:16px;height:16px;border-radius:50%;border:1.5px solid var(--muted);"></span>';

    var saveBar = state.draft.length > 0
      ? '<button data-action="save-session" class="hov-bright" style="width:100%;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;">Save Session ✓</button>'
      : '<div style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:16px;border-radius:4px;text-align:center;">' + (cardio ? "Add an interval to save" : "Add a set to save") + '</div>';

    // HERO — strength: single personal best · cardio: three-metric strip (time / distance / pace)
    var heroHtml = cardio
      ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
          cardioStats.map(function (cs) {
            return '<div style="background:var(--bg);padding:14px 13px;">' +
                '<div style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;white-space:nowrap;">' + esc(cs.label) + '</div>' +
                '<div style="display:flex;align-items:baseline;gap:3px;"><span style="font-family:\'Doto\',monospace;font-weight:900;font-size:32px;line-height:0.8;color:var(--accent);">' + esc(cs.val) + '</span><span style="font-size:10px;color:var(--muted);">' + esc(cs.unit) + '</span></div>' +
              '</div>';
          }).join("") +
        '</div>'
      : '<div style="display:flex;align-items:flex-end;gap:14px;padding-bottom:20px;border-bottom:1px solid var(--border);">' +
          '<div>' +
            '<div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">' + esc(pbLabel) + '</div>' +
            '<div style="display:flex;align-items:baseline;gap:6px;"><span style="font-family:\'Doto\',monospace;font-weight:900;font-size:54px;line-height:0.8;color:var(--accent);">' + esc(pr) + '</span><span style="font-size:14px;color:var(--muted);">' + esc(pbUnit) + '</span></div>' +
          '</div>' +
        '</div>';

    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="padding:54px 22px 12px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">' +
        '<button data-action="go-home" class="hov-border-accent" style="width:42px;height:42px;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
        '<button data-action="toggle-am-fav" class="hov-border-accent" style="width:42px;height:42px;background:transparent;border:1px solid var(--border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + amFavDot + '</button>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:4px 22px 120px;">' +
        '<div style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">' + esc(amGroup) + '</div>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:34px;line-height:1.0;color:var(--text);margin-bottom:20px;">' + esc(amName) + '</div>' +
        heroHtml +
        '<div style="margin-top:22px;">' +
          '<div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--text);margin-bottom:12px;">' + esc(chartTitle) + '</div>' +
          chartHtml +
        '</div>' +
        '<div style="margin-top:26px;display:flex;align-items:center;gap:10px;">' +
          '<span style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--text);">' + esc(setsTitle) + '</span>' +
          '<span style="flex:1;height:1px;background:var(--border);"></span>' +
        '</div>' +
        draftRows +
        '<div style="display:flex;gap:10px;margin-top:12px;">' +
          '<button data-action="add-set" class="hov-accent" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;">＋ ' + (cardio ? "Add Interval" : "Add Set") + '</button>' +
          '<button data-action="dup-set" class="hov-accent" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;">⎘ Duplicate Last</button>' +
        '</div>' +
        historyHtml +
      '</div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);">' + saveBar + '</div>' +
    '</div>';
  }

  // ── ADD MACHINE ──
  function viewAdd() {
    var chips = GROUPS.map(function (g) {
      var active = g === state.addGroup;
      var dot = active
        ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);"></span>'
        : '<span style="width:8px;height:8px;border-radius:50%;border:1px solid var(--border);"></span>';
      return '<button data-action="pick-group" data-g="' + esc(g) + '" style="display:flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;letter-spacing:0.06em;text-transform:uppercase;padding:10px 14px;border-radius:4px;cursor:pointer;">' + dot + esc(g) + '</button>';
    }).join("");

    var photo = state.addPhoto
      ? '<img src="' + esc(state.addPhoto) + '" style="width:100%;height:200px;object-fit:cover;border:1px solid var(--border);border-radius:6px;" />'
      : '<div style="width:100%;height:200px;border:1px dashed var(--border);border-radius:6px;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted);">' +
          '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.6"></circle><path d="M21 15l-5-5L5 21"></path></svg>' +
          '<span style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">Tap to choose from gallery</span>' +
        '</div>';

    var saveBar = state.addName.trim().length > 0
      ? '<button data-action="save-machine" class="hov-bright" style="width:100%;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;">Save Machine ✓</button>'
      : '<div style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:16px;border-radius:4px;text-align:center;">Enter a name to save</div>';

    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="padding:54px 22px 12px;flex-shrink:0;display:flex;align-items:center;gap:14px;">' +
        '<button data-action="go-home" class="hov-border-accent" style="width:42px;height:42px;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:30px;color:var(--text);">NEW MACHINE</div>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:8px 22px 120px;">' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;">Name</div>' +
        '<input id="input-addname" value="' + esc(state.addName) + '" placeholder="e.g. Smith Machine" autocomplete="off" style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:16px;padding:14px 16px;outline:none;border-radius:4px;margin-bottom:24px;" />' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">Muscle Group</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:9px;margin-bottom:26px;">' + chips + '</div>' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">Photo</div>' +
        '<label style="display:block;cursor:pointer;">' +
          '<input id="input-photo" type="file" accept="image/*" style="display:none;" />' + photo +
        '</label>' +
      '</div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);">' + saveBar + '</div>' +
    '</div>';
  }

  // ── SETTINGS ──
  function viewSettings(isDark, ul) {
    var seg = function (label, action, active) {
      var st = active
        ? "background:var(--text);color:var(--bg);border:1px solid var(--text);"
        : "background:transparent;color:var(--muted);border:1px solid var(--border);";
      return '<button data-action="' + action + '" style="flex:1;' + st + 'font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:15px;border-radius:4px;cursor:pointer;">' + label + '</button>';
    };
    var unitSeg = function (label, action, active) {
      var st = active
        ? "background:var(--accent);color:#fff;border:1px solid var(--accent);"
        : "background:transparent;color:var(--muted);border:1px solid var(--border);";
      return '<button data-action="' + action + '" style="flex:1;' + st + 'font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:15px;border-radius:4px;cursor:pointer;">' + label + '</button>';
    };
    var uname = (state.user && state.user.name) || "?";
    var uemail = (state.user && state.user.email) || "";
    var initial = uname.charAt(0).toUpperCase();

    var msg = state.settingsMsg
      ? '<div style="margin-top:12px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:' + (state.settingsMsgOk ? "var(--muted)" : "var(--accent)") + ';">' + esc(state.settingsMsg) + '</div>'
      : "";

    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="padding:54px 22px 12px;flex-shrink:0;display:flex;align-items:center;gap:14px;">' +
        '<button data-action="go-home" class="hov-border-accent" style="width:42px;height:42px;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:32px;color:var(--text);">SETTINGS</div>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:18px 22px 40px;">' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;">Appearance</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:30px;">' + seg("Light", "theme-light", !isDark) + seg("Dark", "theme-dark", isDark) + '</div>' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;">Weight Unit</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:30px;">' + unitSeg("Kilograms", "unit-kg", ul === "kg") + unitSeg("Pounds", "unit-lb", ul === "lb") + '</div>' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;">Data &amp; Backup</div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button data-action="export-backup" class="hov-accent" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;">⤓ Export</button>' +
          '<label class="hov-accent" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text);font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;text-align:center;display:block;">⤒ Restore<input id="input-restore" type="file" accept="application/json,.json" style="display:none;" /></label>' +
        '</div>' +
        '<div style="margin-top:9px;font-size:10px;letter-spacing:0.1em;color:var(--muted);line-height:1.5;">On iPhone, Export opens the share sheet — choose <b style="color:var(--text);font-weight:700;">Save to Files → iCloud Drive</b> and Apple syncs it across your devices. Restore loads a backup back. Elsewhere, Export just downloads the .json.</div>' +
        msg +
        '<div style="height:30px;"></div>' +
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;">Account</div>' +
        '<div style="display:flex;align-items:center;gap:13px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:15px;margin-bottom:14px;">' +
          '<div style="width:44px;height:44px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:\'Doto\',monospace;font-weight:900;font-size:20px;color:#fff;">' + esc(initial) + '</div>' +
          '<div style="min-width:0;"><div style="font-size:15px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(uname) + '</div><div style="font-size:10px;letter-spacing:0.06em;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(uemail) + '</div></div>' +
        '</div>' +
        (passkeysAvailable()
          ? '<button data-action="add-passkey" class="hov-accent" style="width:100%;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:9px;background:transparent;border:1px solid var(--border);color:var(--text);font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:14px;border-radius:4px;cursor:pointer;">' + passkeyIcon() + 'Add a passkey</button>'
          : '') +
        '<button data-action="logout" class="hov-border-accent" style="width:100%;background:transparent;border:1px solid var(--border);color:var(--accent);font-weight:700;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:15px;border-radius:4px;cursor:pointer;">Log Out</button>' +
        '<button data-action="delete-account" class="hov-bright" style="width:100%;margin-top:10px;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:15px;border-radius:4px;cursor:pointer;">Delete Account</button>' +
        '<div style="text-align:center;margin-top:34px;font-family:\'Doto\',monospace;font-weight:700;font-size:13px;letter-spacing:0.3em;color:var(--muted);">FORGELIFT · v1.0</div>' +
      '</div></div>';
  }

  // ════════════════════════ EVENTS ════════════════════════
  var ACTIONS = {
    "auth-email": submitEmail,
    "auth-toggle": toggleAuthMode,
    "auth-passkey": authPasskey,
    "add-passkey": addPasskey,
    "open-settings": openSettings,
    "open-add": openAdd,
    "go-home": goHome,
    "open-machine": function (el) { openMachine(el.getAttribute("data-id")); },
    "toggle-fav": function (el) { toggleFav(el.getAttribute("data-id")); },
    "toggle-am-fav": function () { if (state.activeId) toggleFav(state.activeId); },
    "add-set": addSet,
    "dup-set": duplicateLast,
    "rep-up": function (el) { repsDelta(+el.getAttribute("data-i"), 1); },
    "rep-dn": function (el) { repsDelta(+el.getAttribute("data-i"), -1); },
    "w-up": function (el) { weightDelta(+el.getAttribute("data-i"), 1); },
    "w-dn": function (el) { weightDelta(+el.getAttribute("data-i"), -1); },
    "dur-up": function (el) { durationDelta(+el.getAttribute("data-i"), 1); },
    "dur-dn": function (el) { durationDelta(+el.getAttribute("data-i"), -1); },
    "dist-up": function (el) { distanceDelta(+el.getAttribute("data-i"), 1); },
    "dist-dn": function (el) { distanceDelta(+el.getAttribute("data-i"), -1); },
    "cal-up": function (el) { caloriesDelta(+el.getAttribute("data-i"), 1); },
    "cal-dn": function (el) { caloriesDelta(+el.getAttribute("data-i"), -1); },
    "remove-set": function (el) { removeSet(+el.getAttribute("data-i")); },
    "save-session": saveSession,
    "pick-group": function (el) { setState({ addGroup: el.getAttribute("data-g") }); },
    "save-machine": saveMachine,
    "theme-light": function () { setTheme("light"); },
    "theme-dark": function () { setTheme("dark"); },
    "unit-kg": function () { setUnit("kg"); },
    "unit-lb": function () { setUnit("lb"); },
    "export-backup": exportBackup,
    "delete-account": deleteAccount,
    "logout": logout,
  };

  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el || !app.contains(el)) return;
    var fn = ACTIONS[el.getAttribute("data-action")];
    if (fn) { e.stopPropagation(); fn(el); }
  });

  app.addEventListener("input", function (e) {
    var id = e.target.id;
    if (id === "input-email") { state.emailDraft = e.target.value; state.loginError = ""; render(); }
    else if (id === "input-password") { state.passwordDraft = e.target.value; state.loginError = ""; render(); }
    else if (id === "input-search") { state.search = e.target.value; render(); }
    else if (id === "input-addname") { state.addName = e.target.value; render(); }
  });

  app.addEventListener("change", function (e) {
    if (e.target.id === "input-photo") {
      handlePhoto(e.target.files && e.target.files[0]);
    } else if (e.target.id === "input-restore") {
      importBackup(e.target.files && e.target.files[0]);
      e.target.value = ""; // allow re-selecting the same file
    }
  });

  // Submit the email/password form with Enter from either field.
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.target.id === "input-email" || e.target.id === "input-password")) {
      e.preventDefault();
      submitEmail();
    }
  });

  render();
  boot();
})();
