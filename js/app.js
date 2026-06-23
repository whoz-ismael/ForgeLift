/* ForgeLift — vanilla JS gym tracker.
 * Ported faithfully from the Claude Design prototype (ForgeLift.dc.html).
 * State lives in memory; per-user data is persisted to Supabase Postgres
 * through window.ForgeLiftAuth (js/supabase.js), behind Supabase Auth. */
(function () {
  "use strict";

  var LB = 0.45359237;
  var MI = 1.609344; // kilometres per mile
  var GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio"];
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  var state = {
    screen: "loading", tab: "week", theme: "dark", unit: "kg",
    user: null,                                  // { id, name, email }
    authMode: "signin",                          // "signin" | "signup"
    emailDraft: "", passwordDraft: "",
    loginError: "", loginNotice: "", busy: false,
    machines: [], logs: {}, activeId: null, draft: [], search: "", pickerSearch: "",
    // Plan organisation: machines are assigned to weekdays (routine) or to named
    // routine lists, depending on orgMode. onboarding picks the mode + units.
    routine: {}, dayNames: {}, selectedDay: 0, orgMode: "week",
    routineLists: [], selectedRoutineId: null,
    onboarded: false, obMode: null, obUnit: null,
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
  // Monday-indexed day of the week (0 = Mon … 6 = Sun).
  function todayIdx() { return (new Date().getDay() + 6) % 7; }

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
      return { id: "m" + i, name: b[0], group: b[1], photo: null };
    });
    var byId = function (nm) { var m = machines.find(function (x) { return x.name === nm; }); return m ? m.id : null; };
    var pick = function (names) { return names.map(byId).filter(Boolean); };
    // Fresh accounts get the catalog (no example history) plus a starter plan —
    // a few weekday assignments and named routine lists to build from.
    var routine = {
      0: pick(["Chest Press", "Incline Press", "Pec Deck", "Bicep Curl", "Tricep Pushdown"]),
      2: pick(["Leg Press", "Hack Squat", "Leg Extension", "Leg Curl", "Calf Raise"]),
      4: pick(["Lat Pulldown", "Seated Row", "Back Extension", "Treadmill"]),
    };
    var dayNames = { 0: "Chest & Arms", 2: "Legs", 4: "Back & Cardio" };
    var routineLists = [
      { id: "r1", name: "Chest & Biceps", machineIds: pick(["Chest Press", "Incline Press", "Pec Deck", "Bicep Curl", "Cable Curl"]) },
      { id: "r2", name: "Back & Abs", machineIds: pick(["Lat Pulldown", "Seated Row", "Ab Crunch", "Cable Crunch"]) },
      { id: "r3", name: "Leg Day", machineIds: pick(["Leg Press", "Leg Extension", "Leg Curl", "Calf Raise"]) },
    ];
    return { machines: machines, logs: {}, routine: routine, dayNames: dayNames, routineLists: routineLists };
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
      routine: state.routine, dayNames: state.dayNames, orgMode: state.orgMode,
      routineLists: state.routineLists, onboarded: state.onboarded,
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
        screen: "login", tab: "week", user: null, machines: [], logs: {}, activeId: null,
        draft: [], search: "", pickerSearch: "", busy: false, authMode: "signin",
        routine: {}, dayNames: {}, routineLists: [], selectedRoutineId: null,
        orgMode: "week", onboarded: false, obMode: null, obUnit: null,
        passwordDraft: "", loginError: "", loginNotice: "",
        settingsMsg: "", settingsMsgOk: false,
      });
    }
  }
  function loadProfileThenHome() {
    window.ForgeLiftAuth.loadProfile().then(function (row) {
      if (row && row.onboarded) {
        // Returning, onboarded user — restore data + plan + preferences.
        var lists = row.routineLists || [];
        setState({
          machines: row.machines || [], logs: row.logs || {},
          routine: row.routine || {}, dayNames: row.dayNames || {},
          routineLists: lists, selectedRoutineId: (lists[0] || {}).id || null,
          orgMode: row.orgMode || "week", selectedDay: todayIdx(), onboarded: true,
          unit: row.unit || state.unit, theme: row.theme || state.theme,
          screen: "home", tab: "week", busy: false, emailDraft: "", passwordDraft: "",
          loginError: "", loginNotice: "",
        });
      } else {
        // New user (no row) or one created before onboarding existed — keep any
        // data they already have, seed a starter plan, then run onboarding once.
        var seeded = seed();
        var hasData = row && Array.isArray(row.machines) && row.machines.length;
        var lists = (row && row.routineLists) || seeded.routineLists;
        setState({
          machines: hasData ? row.machines : seeded.machines,
          logs: (row && row.logs) || {},
          routine: (row && row.routine) || seeded.routine,
          dayNames: (row && row.dayNames) || seeded.dayNames,
          routineLists: lists, selectedRoutineId: (lists[0] || {}).id || null,
          orgMode: (row && row.orgMode) || "week", selectedDay: todayIdx(), onboarded: false,
          unit: (row && row.unit) || state.unit, theme: (row && row.theme) || state.theme,
          screen: "onboarding", obMode: null, obUnit: null,
          busy: false, emailDraft: "", passwordDraft: "", loginError: "", loginNotice: "",
        });
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
      screen: "login", tab: "week", user: null, machines: [], logs: {}, activeId: null,
      draft: [], search: "", pickerSearch: "", busy: false, authMode: "signin",
      routine: {}, dayNames: {}, routineLists: [], selectedRoutineId: null,
      orgMode: "week", onboarded: false, obMode: null, obUnit: null,
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
  function openPicker() { setState({ screen: "picker", pickerSearch: "" }); }
  function goHome() { setState({ screen: "home", search: "", settingsMsg: "", settingsMsgOk: false }); }
  function goWeek() { setState({ tab: "week" }); }
  function goLibrary() { setState({ tab: "library", search: "" }); }
  function openMachine(id) { setState({ activeId: id, draft: [], screen: "machine" }); }
  function selectDay(i) { setState({ selectedDay: i }); }

  // ── onboarding (first sign-in: pick organisation + units) ──
  function setObMode(m) { setState({ obMode: m }); }
  function setObUnit(u) { setState({ obUnit: u }); }
  function finishOnboarding() {
    if (!state.obMode || !state.obUnit) return;
    setState({ orgMode: state.obMode, unit: state.obUnit, onboarded: true, screen: "home", tab: "week" }, true);
  }

  // ── weekday assignments (routine[dayIdx] = [machineId…]) ──
  function dayMachineIds(i) { return state.routine[i] || []; }
  function inDay(i, id) { return dayMachineIds(i).indexOf(id) !== -1; }
  function machineDays(id) { var out = []; for (var i = 0; i < 7; i++) { if (inDay(i, id)) out.push(DAYS[i]); } return out; }
  function toggleDayMachine(i, id) {
    var cur = dayMachineIds(i);
    var next = cur.indexOf(id) !== -1 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id]);
    var routine = Object.assign({}, state.routine); routine[i] = next;
    setState({ routine: routine }, true);
  }
  function removeFromDay(i, id) {
    var routine = Object.assign({}, state.routine);
    routine[i] = dayMachineIds(i).filter(function (x) { return x !== id; });
    setState({ routine: routine }, true);
  }
  function moveInDay(i, idx, dir) {
    var cur = dayMachineIds(i).slice(), j = idx + dir;
    if (j < 0 || j >= cur.length) return;
    var t = cur[idx]; cur[idx] = cur[j]; cur[j] = t;
    var routine = Object.assign({}, state.routine); routine[i] = cur;
    setState({ routine: routine }, true);
  }
  function setDayName(val) {
    var dayNames = Object.assign({}, state.dayNames); dayNames[state.selectedDay] = val;
    setState({ dayNames: dayNames }, true);
  }

  // ── routine lists (day-independent organisation) ──
  function routineById(id) { return state.routineLists.find(function (r) { return r.id === id; }) || null; }
  function inRoutine(rid, mid) { var r = routineById(rid); return !!r && r.machineIds.indexOf(mid) !== -1; }
  function machineRoutines(mid) { return state.routineLists.filter(function (r) { return r.machineIds.indexOf(mid) !== -1; }); }
  function selectRoutine(id) { setState({ selectedRoutineId: id }); }
  function setOrgWeek() { setState({ orgMode: "week" }, true); }
  function setOrgRoutines() {
    var cur = state.selectedRoutineId && routineById(state.selectedRoutineId)
      ? state.selectedRoutineId : (state.routineLists[0] ? state.routineLists[0].id : null);
    setState({ orgMode: "routines", selectedRoutineId: cur }, true);
  }
  function toggleRoutineMachine(rid, mid) {
    var next = state.routineLists.map(function (r) {
      return r.id === rid ? Object.assign({}, r, { machineIds: r.machineIds.indexOf(mid) !== -1
        ? r.machineIds.filter(function (x) { return x !== mid; })
        : r.machineIds.concat([mid]) }) : r;
    });
    setState({ routineLists: next }, true);
  }
  function removeFromRoutine(rid, mid) {
    var next = state.routineLists.map(function (r) {
      return r.id === rid ? Object.assign({}, r, { machineIds: r.machineIds.filter(function (x) { return x !== mid; }) }) : r;
    });
    setState({ routineLists: next }, true);
  }
  function moveInRoutine(rid, idx, dir) {
    var next = state.routineLists.map(function (r) {
      if (r.id !== rid) return r;
      var arr = r.machineIds.slice(), j = idx + dir; if (j < 0 || j >= arr.length) return r;
      var t = arr[idx]; arr[idx] = arr[j]; arr[j] = t; return Object.assign({}, r, { machineIds: arr });
    });
    setState({ routineLists: next }, true);
  }
  function setRoutineName(val) {
    var next = state.routineLists.map(function (r) {
      return r.id === state.selectedRoutineId ? Object.assign({}, r, { name: val }) : r;
    });
    setState({ routineLists: next }, true);
  }
  function createRoutine() {
    var id = "r" + Date.now();
    var next = state.routineLists.concat([{ id: id, name: "Routine " + (state.routineLists.length + 1), machineIds: [] }]);
    setState({ routineLists: next, selectedRoutineId: id }, true);
  }
  function deleteRoutine() {
    var id = state.selectedRoutineId;
    var next = state.routineLists.filter(function (r) { return r.id !== id; });
    setState({ routineLists: next, selectedRoutineId: next.length ? next[0].id : null }, true);
  }
  // Picker toggles a machine into the active day (week mode) or routine.
  function pickerToggle(id) {
    if (state.orgMode === "week") toggleDayMachine(state.selectedDay, id);
    else if (state.selectedRoutineId) toggleRoutineMachine(state.selectedRoutineId, id);
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
    var m = { id: "c" + Date.now(), name: n, group: state.addGroup, photo: state.addPhoto };
    setState({ machines: state.machines.concat([m]), addName: "", addPhoto: null, tab: "library", screen: "home" }, true);
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
        photo: typeof m.photo === "string" ? m.photo : null,
      };
    });
  }
  function sanitizeRoutine(obj, ids) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var i = Number(k);
      if (i < 0 || i > 6 || !Array.isArray(obj[k])) return;
      var list = obj[k].map(String).filter(function (id) { return ids.indexOf(id) >= 0; });
      if (list.length) out[i] = list;
    });
    return out;
  }
  function sanitizeDayNames(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var i = Number(k);
      if (i >= 0 && i <= 6 && obj[k] != null) out[i] = String(obj[k]);
    });
    return out;
  }
  function sanitizeRoutineLists(arr, ids) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (r) { return r && r.id != null; }).map(function (r) {
      return {
        id: String(r.id),
        name: String(r.name || "Routine"),
        machineIds: Array.isArray(r.machineIds) ? r.machineIds.map(String).filter(function (id) { return ids.indexOf(id) >= 0; }) : [],
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
        data: {
          machines: state.machines, logs: state.logs, unit: state.unit, theme: state.theme,
          routine: state.routine, dayNames: state.dayNames, orgMode: state.orgMode, routineLists: state.routineLists,
        },
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
      var ids = machines.map(function (m) { return m.id; });
      var routine = sanitizeRoutine(d.routine, ids);
      var dayNames = sanitizeDayNames(d.dayNames);
      var routineLists = sanitizeRoutineLists(d.routineLists, ids);
      var orgMode = d.orgMode === "routines" ? "routines" : "week";
      setState({
        machines: machines, logs: logs, unit: unit, theme: theme,
        routine: routine, dayNames: dayNames, routineLists: routineLists, orgMode: orgMode,
        selectedRoutineId: (routineLists[0] || {}).id || null,
        settingsMsg: "BACKUP RESTORED · " + machines.length + " MACHINES", settingsMsgOk: true,
      }, true);
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
  function lastDetail(m) {
    var sess = state.logs[m.id] || [];
    var last = sess.length ? sess[sess.length - 1] : null;
    if (!last) return "—";
    if (isCardio(m)) {
      var dist = sumField(last, "distance");
      return dist > 0 ? dispDist(dist) + " " + distUnit() : sumField(last, "duration") + " min";
    }
    return dispW(Math.max.apply(null, last.sets.map(function (s) { return s.weight; }))) + " " + state.unit;
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
    // Machine equipment illustrations — line-art, 40×40 viewBox. ${a} fills the
    // weight stacks / pads accent; the rest is the ${c} stroke.
    var P = {
      press: `<line x1="3" y1="37" x2="37" y2="37"/><rect x="29" y="6" width="7" height="26" rx="1"/><rect x="29" y="13" width="7" height="5" fill="${a}" stroke="none"/><line x1="29" y1="32" x2="8" y2="32"/><line x1="8" y1="32" x2="8" y2="37"/><line x1="16" y1="37" x2="16" y2="30"/><rect x="10" y="28" width="12" height="3.5" rx="1.5"/><rect x="6" y="15" width="3.5" height="14" rx="1.5"/><line x1="10" y1="29" x2="16" y2="29"/><path d="M21 23 L29 17"/><line x1="16" y1="20" x2="26" y2="26"/>`,
      curl: `<line x1="3" y1="37" x2="37" y2="37"/><rect x="29" y="7" width="6" height="24" rx="1"/><rect x="29" y="13" width="6" height="6" fill="${a}" stroke="none"/><line x1="10" y1="37" x2="29" y2="37"/><line x1="13" y1="37" x2="13" y2="29"/><rect x="8" y="27" width="10" height="3.5" rx="1.5"/><path d="M13 29 Q14 16 26 16" stroke-width="2.5"/><rect x="23" y="14" width="7" height="4" rx="1.5" fill="${a}" stroke="none"/>`,
      lateral: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="20" y1="9" x2="20" y2="37"/><rect x="16" y="23" width="8" height="10" rx="1"/><rect x="16" y="24" width="8" height="4" rx="1" fill="${a}" stroke="none"/><path d="M20 20 L7 25"/><path d="M20 20 L33 25"/><rect x="4" y="23" width="5" height="4" rx="1" fill="${a}" stroke="none"/><rect x="31" y="23" width="5" height="4" rx="1" fill="${a}" stroke="none"/>`,
      fly: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="5" y1="5" x2="5" y2="37"/><line x1="35" y1="5" x2="35" y2="37"/><line x1="5" y1="5" x2="35" y2="5"/><rect x="2" y="26" width="6" height="12" rx="0.5" fill="${a}" stroke="none"/><rect x="32" y="26" width="6" height="12" rx="0.5" fill="${a}" stroke="none"/><line x1="5" y1="11" x2="15" y2="21"/><line x1="35" y1="11" x2="25" y2="21"/><circle cx="15" cy="21" r="3" fill="${a}" stroke="none"/><circle cx="25" cy="21" r="3" fill="${a}" stroke="none"/>`,
      pulldown: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="6" y1="5" x2="6" y2="37"/><line x1="34" y1="5" x2="34" y2="37"/><line x1="6" y1="5" x2="34" y2="5"/><rect x="32" y="8" width="7" height="22" rx="1" fill="${a}" stroke="none"/><line x1="20" y1="5" x2="20" y2="13"/><line x1="11" y1="13" x2="29" y2="13"/><rect x="9" y="11" width="4" height="4" rx="1" fill="${a}" stroke="none"/><rect x="27" y="11" width="4" height="4" rx="1" fill="${a}" stroke="none"/><rect x="13" y="27" width="14" height="4" rx="1.5"/><rect x="11" y="31" width="18" height="3.5" rx="1.5"/>`,
      row: `<line x1="3" y1="37" x2="37" y2="37"/><rect x="3" y="11" width="7" height="22" rx="1"/><rect x="3" y="18" width="7" height="6" fill="${a}" stroke="none"/><line x1="10" y1="22" x2="33" y2="22"/><circle cx="21" cy="22" r="3" fill="${a}" stroke="none"/><rect x="19" y="26" width="10" height="3.5" rx="1.5"/><line x1="24" y1="30" x2="24" y2="37"/><line x1="33" y1="22" x2="33" y2="37"/><rect x="8" y="33" width="10" height="3" rx="1.5"/>`,
      pullup: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="6" y1="5" x2="6" y2="37"/><line x1="34" y1="5" x2="34" y2="37"/><line x1="6" y1="5" x2="34" y2="5"/><line x1="13" y1="5" x2="13" y2="27"/><line x1="27" y1="5" x2="27" y2="27"/><rect x="13" y="27" width="14" height="3.5" rx="1.5"/><rect x="32" y="9" width="7" height="20" rx="1" fill="${a}" stroke="none"/>`,
      backext: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="5" y1="37" x2="5" y2="20"/><path d="M5 20 L27 9"/><rect x="22" y="7" width="14" height="5" rx="1.5" fill="${a}" stroke="none"/><rect x="9" y="25" width="10" height="4.5" rx="1.5"/><line x1="5" y1="27" x2="9" y2="27"/><line x1="27" y1="9" x2="27" y2="37"/>`,
      legpress: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="5" y1="37" x2="5" y2="22"/><path d="M5 22 L22 9"/><rect x="18" y="7" width="16" height="5" rx="1.5" fill="${a}" stroke="none"/><rect x="3" y="21" width="12" height="3.5" rx="1.5"/><line x1="15" y1="22" x2="15" y2="37"/><line x1="5" y1="29" x2="15" y2="29"/>`,
      legext: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="8" y1="10" x2="8" y2="37"/><line x1="27" y1="10" x2="27" y2="37"/><rect x="8" y="18" width="19" height="4" rx="1.5"/><rect x="31" y="6" width="5" height="18" rx="1" fill="${a}" stroke="none"/><line x1="27" y1="22" x2="32" y2="22"/><path d="M17 22 L24 33"/><rect x="21" y="32" width="8" height="4" rx="1.5" fill="${a}" stroke="none"/>`,
      legcurl: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="5" y1="17" x2="5" y2="37"/><line x1="35" y1="17" x2="35" y2="37"/><path d="M5 17 Q20 8 35 17"/><rect x="12" y="13" width="16" height="5" rx="1.5" fill="${a}" stroke="none"/><path d="M28 31 Q35 26 35 19"/><rect x="25" y="29" width="8" height="4" rx="1.5" fill="${a}" stroke="none"/>`,
      squat: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="7" y1="4" x2="7" y2="37"/><line x1="33" y1="4" x2="33" y2="37"/><line x1="7" y1="4" x2="33" y2="4"/><line x1="5" y1="18" x2="35" y2="18"/><rect x="4" y="16" width="6" height="5" rx="1" fill="${a}" stroke="none"/><rect x="30" y="16" width="6" height="5" rx="1" fill="${a}" stroke="none"/><line x1="7" y1="28" x2="33" y2="28"/>`,
      calf: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="20" y1="5" x2="20" y2="37"/><line x1="7" y1="5" x2="33" y2="5"/><line x1="7" y1="5" x2="7" y2="14"/><line x1="33" y1="5" x2="33" y2="14"/><line x1="7" y1="14" x2="33" y2="14"/><rect x="13" y="12" width="14" height="4" rx="1.5" fill="${a}" stroke="none"/><rect x="12" y="32" width="16" height="5" rx="2"/>`,
      pushdown: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="20" y1="4" x2="20" y2="37"/><line x1="7" y1="4" x2="33" y2="4"/><line x1="7" y1="4" x2="7" y2="19"/><line x1="33" y1="4" x2="33" y2="19"/><rect x="17" y="7" width="6" height="20" rx="1" fill="${a}" stroke="none"/><line x1="20" y1="27" x2="14" y2="33"/><line x1="20" y1="27" x2="26" y2="33"/><line x1="12" y1="33" x2="28" y2="33"/>`,
      crunch: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="20" y1="7" x2="20" y2="37"/><rect x="29" y="9" width="6" height="20" rx="1" fill="${a}" stroke="none"/><line x1="20" y1="18" x2="29" y2="14"/><rect x="11" y="26" width="18" height="4" rx="1.5"/><line x1="20" y1="26" x2="20" y2="37"/><path d="M14 24 L8 16"/><path d="M26 24 L32 16"/>`,
      run: `<line x1="3" y1="37" x2="37" y2="37"/><rect x="4" y="21" width="26" height="8" rx="1.5"/><line x1="28" y1="21" x2="34" y2="6"/><rect x="30" y="4" width="8" height="6" rx="1"/><line x1="4" y1="29" x2="4" y2="37"/><line x1="30" y1="29" x2="30" y2="37"/>`,
      bike: `<line x1="3" y1="37" x2="37" y2="37"/><circle cx="29" cy="28" r="7"/><circle cx="29" cy="28" r="2.5" fill="${a}" stroke="none"/><line x1="10" y1="37" x2="21" y2="23"/><line x1="21" y1="23" x2="29" y2="28"/><line x1="21" y1="23" x2="17" y2="14"/><line x1="13" y1="13" x2="21" y2="13"/><line x1="21" y1="23" x2="29" y2="17"/><line x1="26" y1="14" x2="33" y2="14"/>`,
      rower: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="4" y1="27" x2="36" y2="31"/><line x1="4" y1="27" x2="4" y2="37"/><line x1="36" y1="31" x2="36" y2="37"/><rect x="4" y="20" width="10" height="7" rx="1.5"/><rect x="4" y="21" width="10" height="3.5" rx="1" fill="${a}" stroke="none"/><line x1="14" y1="24" x2="35" y2="21"/><circle cx="25" cy="27" r="2.5"/>`,
      stairs: `<line x1="3" y1="37" x2="37" y2="37"/><line x1="8" y1="5" x2="8" y2="37"/><line x1="32" y1="5" x2="32" y2="37"/><line x1="8" y1="5" x2="32" y2="5"/><rect x="8" y="9" width="10" height="5" rx="0.5" fill="${a}" stroke="none"/><rect x="22" y="17" width="10" height="5" rx="0.5" fill="${a}" stroke="none"/><rect x="8" y="25" width="10" height="5" rx="0.5" fill="${a}" stroke="none"/><line x1="8" y1="14" x2="22" y2="17"/><line x1="22" y1="22" x2="8" y2="25"/>`,
      cardio: `<line x1="3" y1="37" x2="37" y2="37"/><ellipse cx="20" cy="31" rx="13" ry="5"/><line x1="11" y1="27" x2="8" y2="7"/><line x1="29" y1="27" x2="32" y2="7"/><line x1="6" y1="9" x2="34" y2="9"/><line x1="8" y1="7" x2="8" y2="20"/><line x1="32" y1="7" x2="32" y2="20"/><circle cx="9" cy="36" r="3" fill="${a}" stroke="none"/><circle cx="31" cy="36" r="3" fill="${a}" stroke="none"/>`,
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
    else if (state.screen === "onboarding") html = viewOnboarding();
    else if (state.screen === "home") html = viewHome(ul, iconStroke, iconAccent);
    else if (state.screen === "picker") html = viewPicker(iconStroke, iconAccent);
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
  // ── ONBOARDING (first sign-in) ──
  function viewOnboarding() {
    var card = function (mode, title, desc) {
      var on = state.obMode === mode;
      var cs = "display:flex;align-items:flex-start;gap:13px;width:100%;text-align:left;padding:16px;border-radius:8px;cursor:pointer;background:" + (on ? "var(--surface)" : "transparent") + ";border:1.5px solid " + (on ? "var(--accent)" : "var(--border)") + ";";
      var ds = "flex-shrink:0;margin-top:2px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:" + (on ? "#fff" : "transparent") + ";border:1.5px solid " + (on ? "var(--accent)" : "var(--border)") + ";background:" + (on ? "var(--accent)" : "transparent") + ";";
      return '<div data-action="ob-mode" data-m="' + mode + '" style="' + cs + '">' +
          '<span style="' + ds + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><path d="M5 12l5 5L20 6"></path></svg></span>' +
          '<div style="flex:1;min-width:0;"><div style="font-family:\'Doto\',monospace;font-weight:700;font-size:17px;letter-spacing:0.04em;color:var(--text);margin-bottom:4px;">' + title + '</div>' +
          '<div style="font-size:11px;letter-spacing:0.02em;line-height:1.55;color:var(--muted);">' + desc + '</div></div>' +
        '</div>';
    };
    var unitBtn = function (u, label) {
      var on = state.obUnit === u;
      var st = "flex:1;background:" + (on ? "var(--accent)" : "transparent") + ";color:" + (on ? "#fff" : "var(--muted)") + ";border:1.5px solid " + (on ? "var(--accent)" : "var(--border)") + ";font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;padding:16px;border-radius:6px;cursor:pointer;";
      return '<button data-action="ob-unit" data-u="' + u + '" style="' + st + '">' + label + '</button>';
    };
    var ready = !!(state.obMode && state.obUnit);
    var btn = ready
      ? '<button data-action="finish-onboarding" class="hov-bright" style="width:100%;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:17px;border-radius:4px;cursor:pointer;">Enter ForgeLift →</button>'
      : '<div style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-weight:700;font-size:13px;letter-spacing:0.16em;text-transform:uppercase;padding:17px;border-radius:4px;text-align:center;">Pick both to continue</div>';
    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="flex:1;overflow:auto;padding:54px 26px 24px;">' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:40px;line-height:0.9;letter-spacing:0.01em;color:var(--text);margin-bottom:8px;">LET\'S SET<br>YOU UP</div>' +
        '<div style="font-size:11px;letter-spacing:0.04em;line-height:1.6;color:var(--muted);margin-bottom:30px;">Two quick choices. You can change both later in Settings.</div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--text);margin-bottom:5px;">How do you train?</div>' +
        '<div style="font-size:10px;letter-spacing:0.04em;color:var(--muted);margin-bottom:13px;">Pick how you want to organize your machines.</div>' +
        '<div style="display:flex;flex-direction:column;gap:11px;margin-bottom:30px;">' +
          card("week", "BY DAY OF THE WEEK", "A list of machines for each weekday you train — e.g. Monday chest, Wednesday legs.") +
          card("routines", "BY ROUTINE LISTS", "Named lists like Chest &amp; Biceps or Back &amp; Abs — no fixed day required.") +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--text);margin-bottom:5px;">Preferred units</div>' +
        '<div style="font-size:10px;letter-spacing:0.04em;color:var(--muted);margin-bottom:13px;">How should we show weights?</div>' +
        '<div style="display:flex;gap:11px;">' + unitBtn("kg", "Kilograms · kg") + unitBtn("lb", "Pounds · lb") + '</div>' +
      '</div>' +
      '<div style="flex-shrink:0;padding:14px 26px 30px;background:linear-gradient(to top,var(--bg) 70%,transparent);">' + btn + '</div>' +
    '</div>';
  }

  // Machine thumbnail (photo or generated icon), `size` px square.
  function thumbHtml(m, size, iconStroke, iconAccent) {
    var s = size + "px";
    return m.photo
      ? '<img src="' + esc(m.photo) + '" style="width:' + s + ';height:' + s + ';border-radius:4px;object-fit:cover;flex-shrink:0;border:1px solid var(--border);" />'
      : '<div style="width:' + s + ';height:' + s + ';border-radius:4px;flex-shrink:0;border:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:center;padding:5px;box-sizing:border-box;"><img src="' + machineIcon(m.name, m.group, iconStroke, iconAccent) + '" style="width:100%;height:100%;object-fit:contain;display:block;" /></div>';
  }
  // An ordered plan row (in a day or routine): position, machine, reorder + remove.
  function planRow(m, idx, n, upAction, dnAction, rmAction, iconStroke, iconAccent) {
    var pos = String(idx + 1).padStart(2, "0");
    var arrowBtn = function (action, disabled, d) {
      var col = disabled ? "var(--border)" : "var(--muted)";
      return '<button data-action="' + action + '" data-i="' + idx + '" style="width:26px;height:21px;background:transparent;border:none;color:' + col + ';cursor:' + (disabled ? "default" : "pointer") + ';display:flex;align-items:center;justify-content:center;">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="' + d + '"></path></svg></button>';
    };
    return '<div style="margin-top:10px;display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--border);">' +
      '<span style="font-family:\'Doto\',monospace;font-weight:700;font-size:14px;color:var(--muted);width:22px;flex-shrink:0;">' + pos + '</span>' +
      '<div data-action="open-machine" data-id="' + esc(m.id) + '" style="display:flex;align-items:center;gap:11px;flex:1;min-width:0;cursor:pointer;">' +
        thumbHtml(m, 40, iconStroke, iconAccent) +
        '<div style="flex:1;min-width:0;"><div style="font-size:15px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(m.name) + '</div>' +
        '<div style="font-size:10px;letter-spacing:0.12em;color:var(--muted);text-transform:uppercase;margin-top:2px;">' + esc(lastDetail(m)) + '</div></div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;flex-shrink:0;">' + arrowBtn(upAction, idx === 0, "M6 15l6-6 6 6") + arrowBtn(dnAction, idx === n - 1, "M6 9l6 6 6-6") + '</div>' +
      '<button data-action="' + rmAction + '" data-id="' + esc(m.id) + '" style="width:30px;height:30px;flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;" class="hov-border-accent"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>' +
    '</div>';
  }
  function planEmpty(title, body) {
    return '<div style="margin-top:22px;border:1px dashed var(--border);border-radius:8px;padding:44px 22px;text-align:center;">' +
      '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:26px;letter-spacing:0.08em;color:var(--muted);margin-bottom:10px;">' + title + '</div>' +
      '<div style="font-size:11px;letter-spacing:0.06em;line-height:1.6;color:var(--muted);">' + body + '</div></div>';
  }

  // ── HOME (Plan / Library tabs) ──
  function viewHome(ul, iconStroke, iconAccent) {
    var greeting = "Hello, " + ((state.user && state.user.name) || "").toUpperCase();
    var homeTitle = state.tab === "week" ? "MY PLAN" : "LIBRARY";
    var settingsBtn = '<button data-action="open-settings" class="hov-border-accent" style="width:42px;height:42px;flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"></path></svg></button>';
    var tabBtn = function (active, action, label) {
      var st = "flex:1;background:" + (active ? "var(--text)" : "transparent") + ";color:" + (active ? "var(--bg)" : "var(--muted)") + ";border:1px solid " + (active ? "var(--text)" : "var(--border)") + ";font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;padding:12px;border-radius:5px;cursor:pointer;";
      return '<button data-action="' + action + '" style="' + st + '">' + label + '</button>';
    };
    var header = '<div style="padding:54px 22px 0;flex-shrink:0;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;">' +
          '<div><div style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">' + esc(greeting) + '</div>' +
          '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:38px;line-height:0.95;color:var(--text);">' + homeTitle + '</div></div>' + settingsBtn +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' + tabBtn(state.tab === "week", "go-week", "Plan") + tabBtn(state.tab === "library", "go-library", "Library") + '</div>' +
      '</div>';

    if (state.tab === "library") return header + libraryBody(ul, iconStroke, iconAccent);
    return header + planBody(iconStroke, iconAccent);
  }

  // Library tab: full catalogue grouped by muscle, with day-assignment badges.
  function libraryBody(ul, iconStroke, iconAccent) {
    var q = state.search.trim().toLowerCase();
    var filt = state.machines.filter(function (m) { return !q || m.name.toLowerCase().includes(q); });
    var groups = [];
    GROUPS.forEach(function (g) {
      var items = filt.filter(function (m) { return m.group === g; });
      if (items.length) groups.push({ group: g, items: items });
    });
    filt.forEach(function (m) {
      if (GROUPS.indexOf(m.group) === -1) {
        var grp = groups.find(function (x) { return x.group === m.group; });
        if (!grp) { grp = { group: m.group, items: [] }; groups.push(grp); }
        grp.items.push(m);
      }
    });
    var row = function (m) {
      var days = machineDays(m.id);
      var badge = days.length
        ? '<span style="font-size:9px;font-weight:700;letter-spacing:0.1em;color:var(--accent);text-transform:uppercase;flex-shrink:0;">' + esc(days.join("·")) + '</span>'
        : "";
      return '<div data-action="open-machine" data-id="' + esc(m.id) + '" style="display:flex;align-items:center;gap:13px;padding:13px 0;border-bottom:1px solid var(--border);cursor:pointer;">' +
        thumbHtml(m, 42, iconStroke, iconAccent) +
        '<div style="flex:1;min-width:0;"><div style="font-size:15px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(m.name) + '</div>' +
        '<div style="font-size:10px;letter-spacing:0.12em;color:var(--muted);text-transform:uppercase;margin-top:2px;">Last · ' + esc(lastDetail(m)) + '</div></div>' +
        badge +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" style="flex-shrink:0;"><path d="M9 5l7 7-7 7"></path></svg>' +
      '</div>';
    };
    var listHtml = groups.map(function (g) {
      return '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;">' +
          '<span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text);">' + esc(g.group) + '</span>' +
          '<span style="font-size:10px;color:var(--muted);">' + g.items.length + '</span>' +
          '<span style="flex:1;height:1px;background:var(--border);"></span>' +
        '</div>' + g.items.map(row).join("");
    }).join("");
    if (!groups.length) listHtml = '<div style="text-align:center;padding:50px 0;font-size:12px;letter-spacing:0.1em;color:var(--muted);">NO MACHINES FOUND</div>';
    return '<div style="padding:16px 22px 0;flex-shrink:0;">' +
        '<div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0 14px;">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path></svg>' +
          '<input id="input-search" value="' + esc(state.search) + '" placeholder="SEARCH MACHINES" style="flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:13px;letter-spacing:0.08em;padding:13px 0;text-transform:uppercase;" />' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:6px 22px 120px;">' + listHtml + '</div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);">' +
        '<button data-action="open-add" class="hov-invert" style="width:100%;background:var(--text);border:none;color:var(--bg);font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;">＋ New Machine</button>' +
      '</div>';
  }

  // Plan tab: weekday assignments or routine lists, depending on orgMode.
  function planBody(iconStroke, iconAccent) {
    var inner, addBtn = true;
    if (state.orgMode === "week") {
      var pills = DAYS.map(function (short, i) {
        var sel = i === state.selectedDay, isToday = i === todayIdx(), n = dayMachineIds(i).length;
        var ps = "flex:1;min-width:0;padding:9px 2px;border-radius:7px;cursor:pointer;text-align:center;background:" + (sel ? "var(--text)" : "var(--surface)") + ";border:1px solid " + (sel ? "var(--text)" : "var(--border)") + ";";
        var ls = "display:block;font-family:'Doto',monospace;font-weight:700;font-size:13px;color:" + (sel ? "var(--bg)" : (isToday ? "var(--accent)" : "var(--text)")) + ";";
        var cs = "display:block;margin-top:3px;font-size:9px;letter-spacing:0.06em;color:" + (sel ? "var(--bg)" : "var(--muted)") + ";";
        return '<div data-action="select-day" data-i="' + i + '" style="' + ps + '"><span style="' + ls + '">' + short + '</span><span style="' + cs + '">' + (n ? n : "·") + '</span></div>';
      }).join("");
      var ids = dayMachineIds(state.selectedDay);
      var label = (state.dayNames[state.selectedDay] || DAYS_FULL[state.selectedDay]).toUpperCase();
      var rows = ids.length
        ? ids.map(function (id, idx) {
            var m = state.machines.find(function (x) { return x.id === id; });
            return m ? planRow(m, idx, ids.length, "move-day-up", "move-day-dn", "remove-day", iconStroke, iconAccent) : "";
          }).join("")
        : planEmpty("REST DAY", "Nothing planned yet.<br>Add the machines you'll use on this day.");
      inner = '<div style="display:flex;gap:6px;">' + pills + '</div>' +
        '<div style="margin-top:24px;display:flex;align-items:center;gap:10px;"><span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text);">' + esc(label) + '</span><span style="flex:1;height:1px;background:var(--border);"></span></div>' +
        '<input id="input-day-name" value="' + esc(state.dayNames[state.selectedDay] || "") + '" placeholder="NAME THIS DAY · E.G. CHEST & ARMS" style="width:100%;margin-top:12px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:\'Doto\',monospace;font-weight:700;font-size:22px;letter-spacing:0.04em;padding:4px 0 9px;outline:none;text-transform:uppercase;" />' +
        rows;
    } else {
      var chips = state.routineLists.map(function (r) {
        var sel = r.id === state.selectedRoutineId;
        var st = "display:flex;align-items:center;gap:6px;background:" + (sel ? "var(--text)" : "transparent") + ";color:" + (sel ? "var(--bg)" : "var(--muted)") + ";border:1px solid " + (sel ? "var(--text)" : "var(--border)") + ";font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:10px 14px;border-radius:7px;cursor:pointer;";
        return '<button data-action="select-routine" data-id="' + esc(r.id) + '" style="' + st + '">' + esc(r.name) + '<span style="font-size:10px;color:' + (sel ? "var(--bg)" : "var(--muted)") + ';">' + r.machineIds.length + '</span></button>';
      }).join("");
      var newChip = '<button data-action="create-routine" style="display:flex;align-items:center;gap:6px;background:transparent;border:1px dashed var(--border);color:var(--muted);font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 14px;border-radius:7px;cursor:pointer;" class="hov-border-accent">＋ New</button>';
      var chipRow = '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + chips + newChip + '</div>';
      var r = routineById(state.selectedRoutineId);
      if (!state.routineLists.length) {
        inner = chipRow + planEmpty("NO ROUTINES YET", "Create a routine like &quot;Chest &amp; Biceps&quot;<br>and fill it with the machines you use.");
        addBtn = false;
      } else if (r) {
        var rIds = r.machineIds;
        var rRows = rIds.length
          ? rIds.map(function (id, idx) {
              var m = state.machines.find(function (x) { return x.id === id; });
              return m ? planRow(m, idx, rIds.length, "move-rt-up", "move-rt-dn", "remove-rt", iconStroke, iconAccent) : "";
            }).join("")
          : planEmpty("EMPTY ROUTINE", "Add the machines this routine uses.");
        inner = chipRow +
          '<div style="margin-top:24px;display:flex;align-items:center;gap:10px;"><span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text);">' + esc(r.name.toUpperCase()) + '</span><span style="flex:1;height:1px;background:var(--border);"></span><button data-action="delete-routine" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;" class="hov-accent-text">Delete</button></div>' +
          '<input id="input-routine-name" value="' + esc(r.name) + '" placeholder="NAME THIS ROUTINE" style="width:100%;margin-top:12px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-family:\'Doto\',monospace;font-weight:700;font-size:22px;letter-spacing:0.04em;padding:4px 0 9px;outline:none;text-transform:uppercase;" />' +
          rRows;
      } else {
        inner = chipRow;
        addBtn = false;
      }
    }
    var bottom = addBtn
      ? '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);"><button data-action="open-picker" class="hov-invert" style="width:100%;background:var(--text);border:none;color:var(--bg);font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;">＋ Add Machines</button></div>'
      : "";
    return '<div style="flex:1;overflow:auto;padding:16px 22px 120px;">' + inner + '</div>' + bottom;
  }

  // ── PICKER (multi-select machines into the active day / routine) ──
  function viewPicker(iconStroke, iconAccent) {
    var week = state.orgMode === "week";
    var ctxName = week
      ? (state.dayNames[state.selectedDay] || DAYS_FULL[state.selectedDay])
      : ((routineById(state.selectedRoutineId) || {}).name || "Routine");
    var ctxKind = week ? DAYS_FULL[state.selectedDay] : "this routine";
    var checked = function (id) { return week ? inDay(state.selectedDay, id) : inRoutine(state.selectedRoutineId, id); };
    var count = week ? dayMachineIds(state.selectedDay).length : ((routineById(state.selectedRoutineId) || { machineIds: [] }).machineIds.length);
    var q = state.pickerSearch.trim().toLowerCase();
    var filt = state.machines.filter(function (m) { return !q || m.name.toLowerCase().includes(q); });
    var groups = [];
    GROUPS.forEach(function (g) {
      var items = filt.filter(function (m) { return m.group === g; });
      if (items.length) groups.push({ group: g, items: items });
    });
    var row = function (m) {
      var on = checked(m.id);
      var mark = on
        ? '<span style="width:26px;height:26px;border-radius:50%;background:var(--accent);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5L20 6"></path></svg></span>'
        : '<span style="width:26px;height:26px;border-radius:50%;border:1.5px solid var(--border);flex-shrink:0;"></span>';
      return '<div data-action="picker-toggle" data-id="' + esc(m.id) + '" style="display:flex;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">' +
        thumbHtml(m, 40, iconStroke, iconAccent) +
        '<div style="flex:1;min-width:0;font-size:15px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(m.name) + '</div>' + mark +
      '</div>';
    };
    var listHtml = groups.map(function (g) {
      return '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;"><span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text);">' + esc(g.group) + '</span><span style="font-size:10px;color:var(--muted);">' + g.items.length + '</span><span style="flex:1;height:1px;background:var(--border);"></span></div>' + g.items.map(row).join("");
    }).join("");
    if (!groups.length) listHtml = '<div style="text-align:center;padding:50px 0;font-size:12px;letter-spacing:0.1em;color:var(--muted);">NO MACHINES FOUND</div>';
    return '<div class="screen" style="display:flex;flex-direction:column;">' +
      '<div style="padding:54px 22px 12px;flex-shrink:0;display:flex;align-items:center;gap:14px;">' +
        '<button data-action="go-home" class="hov-border-accent" style="width:42px;height:42px;flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:50%;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
        '<div style="min-width:0;"><div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">Add to ' + esc(ctxKind) + '</div>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:26px;line-height:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(ctxName) + '</div></div>' +
      '</div>' +
      '<div style="padding:6px 22px 0;flex-shrink:0;"><div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0 14px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path></svg><input id="input-picker-search" value="' + esc(state.pickerSearch) + '" placeholder="SEARCH MACHINES" style="flex:1;background:transparent;border:none;outline:none;color:var(--text);font-size:13px;letter-spacing:0.08em;padding:13px 0;text-transform:uppercase;" /></div></div>' +
      '<div style="flex:1;overflow:auto;padding:6px 22px 120px;">' + listHtml + '</div>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:14px 22px 30px;background:linear-gradient(to top,var(--bg) 60%,transparent);"><button data-action="go-home" class="hov-bright" style="width:100%;background:var(--accent);border:none;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;padding:16px;border-radius:4px;cursor:pointer;">Done · ' + count + ' selected</button></div>' +
    '</div>';
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

    // ASSIGNMENT — put this machine on weekdays (week mode) or in routines.
    var assignHtml = "";
    if (am) {
      if (state.orgMode === "week") {
        var dayToggles = DAYS.map(function (short, i) {
          var on = inDay(i, am.id);
          var st = "flex:1;min-width:0;text-align:center;padding:9px 0;border-radius:6px;cursor:pointer;font-family:'Doto',monospace;font-weight:700;font-size:12px;background:" + (on ? "var(--accent)" : "transparent") + ";color:" + (on ? "#fff" : "var(--muted)") + ";border:1px solid " + (on ? "var(--accent)" : "var(--border)") + ";";
          return '<div data-action="toggle-day" data-i="' + i + '" style="' + st + '">' + short + '</div>';
        }).join("");
        assignHtml = '<div style="margin-bottom:22px;"><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:9px;">In Your Week</div><div style="display:flex;gap:5px;">' + dayToggles + '</div></div>';
      } else if (state.routineLists.length) {
        var rtToggles = state.routineLists.map(function (r) {
          var on = inRoutine(r.id, am.id);
          var st = "background:" + (on ? "var(--accent)" : "transparent") + ";color:" + (on ? "#fff" : "var(--muted)") + ";border:1px solid " + (on ? "var(--accent)" : "var(--border)") + ";font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:9px 13px;border-radius:7px;cursor:pointer;";
          return '<div data-action="toggle-rt-machine" data-id="' + esc(r.id) + '" style="' + st + '">' + esc(r.name) + '</div>';
        }).join("");
        assignHtml = '<div style="margin-bottom:22px;"><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:9px;">In Your Routines</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + rtToggles + '</div></div>';
      } else {
        assignHtml = '<div style="margin-bottom:22px;"><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:9px;">In Your Routines</div><div style="font-size:11px;color:var(--muted);">No routines yet — create one in the Plan tab.</div></div>';
      }
    }

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
      '</div>' +
      '<div style="flex:1;overflow:auto;padding:4px 22px 120px;">' +
        '<div style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">' + esc(amGroup) + '</div>' +
        '<div style="font-family:\'Doto\',monospace;font-weight:900;font-size:34px;line-height:1.0;color:var(--text);margin-bottom:18px;">' + esc(amName) + '</div>' +
        assignHtml +
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
        '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;">Plan Organization</div>' +
        '<div style="font-size:10px;letter-spacing:0.02em;line-height:1.5;color:var(--muted);margin-bottom:11px;">' + (state.orgMode === "week" ? "Machines grouped by weekday in the Plan tab." : "Machines grouped into named routine lists.") + '</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:30px;">' + unitSeg("By Day", "org-week", state.orgMode === "week") + unitSeg("Routines", "org-routines", state.orgMode === "routines") + '</div>' +
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
    "ob-mode": function (el) { setObMode(el.getAttribute("data-m")); },
    "ob-unit": function (el) { setObUnit(el.getAttribute("data-u")); },
    "finish-onboarding": finishOnboarding,
    "open-settings": openSettings,
    "open-add": openAdd,
    "open-picker": openPicker,
    "go-home": goHome,
    "go-week": goWeek,
    "go-library": goLibrary,
    "open-machine": function (el) { openMachine(el.getAttribute("data-id")); },
    "select-day": function (el) { selectDay(+el.getAttribute("data-i")); },
    "select-routine": function (el) { selectRoutine(el.getAttribute("data-id")); },
    "create-routine": createRoutine,
    "delete-routine": deleteRoutine,
    "picker-toggle": function (el) { pickerToggle(el.getAttribute("data-id")); },
    "toggle-day": function (el) { if (state.activeId) toggleDayMachine(+el.getAttribute("data-i"), state.activeId); },
    "toggle-rt-machine": function (el) { if (state.activeId) toggleRoutineMachine(el.getAttribute("data-id"), state.activeId); },
    "move-day-up": function (el) { moveInDay(state.selectedDay, +el.getAttribute("data-i"), -1); },
    "move-day-dn": function (el) { moveInDay(state.selectedDay, +el.getAttribute("data-i"), 1); },
    "remove-day": function (el) { removeFromDay(state.selectedDay, el.getAttribute("data-id")); },
    "move-rt-up": function (el) { moveInRoutine(state.selectedRoutineId, +el.getAttribute("data-i"), -1); },
    "move-rt-dn": function (el) { moveInRoutine(state.selectedRoutineId, +el.getAttribute("data-i"), 1); },
    "remove-rt": function (el) { removeFromRoutine(state.selectedRoutineId, el.getAttribute("data-id")); },
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
    "org-week": setOrgWeek,
    "org-routines": setOrgRoutines,
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
    else if (id === "input-picker-search") { state.pickerSearch = e.target.value; render(); }
    else if (id === "input-day-name") { setDayName(e.target.value); }
    else if (id === "input-routine-name") { setRoutineName(e.target.value); }
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
