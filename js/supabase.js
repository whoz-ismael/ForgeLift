/* ForgeLift — Supabase auth + data layer.
 *
 * Real authentication via Supabase Auth: email + password, plus passwordless
 * passkeys (WebAuthn). Each signed-in user owns one row in the `profiles`
 * table; Row Level Security ties every row to auth.uid(), so the user's JWT is
 * what grants access — the browser reads and writes only its own data.
 * See supabase/migrations/.
 *
 * Loads before js/app.js, which uses window.ForgeLiftAuth. */
(function () {
  "use strict";

  // Public project URL + anon key — safe to ship in the client. With RLS on,
  // the anon/JWT key only ever exposes the signed-in user's own row.
  var SUPABASE_URL = "https://gsnmhmihngkjbklhkbju.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdzbm1obWlobmdramJrbGhrYmp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzg4NTQsImV4cCI6MjA5NzY1NDg1NH0.OQ4ZTFdwBccFr3HT7sVk_VvQBzz2YjeX6LOtMmyV1Zk";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("ForgeLift: supabase-js failed to load (offline?).");
    window.ForgeLiftAuth = { ready: false };
    return;
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
      // Opt in to passkey (WebAuthn) support — experimental in supabase-js.
      experimental: { passkey: true },
    },
  });

  // WebAuthn is only available in secure contexts with the right browser API.
  var passkeysSupported = typeof window.PublicKeyCredential !== "undefined" &&
    typeof client.auth.signInWithPasskey === "function";

  window.ForgeLiftAuth = {
    ready: true,
    passkeysSupported: passkeysSupported,

    // Fires on first load and on sign in / out.
    onChange: function (cb) {
      client.auth.onAuthStateChange(function (_event, session) { cb(session); });
    },
    getSession: function () {
      return client.auth.getSession().then(function (r) { return r.data.session; });
    },

    signUpEmail:  function (email, password) { return client.auth.signUp({ email: email, password: password }); },
    signInEmail:  function (email, password) { return client.auth.signInWithPassword({ email: email, password: password }); },
    signOut:      function () { return client.auth.signOut(); },

    // Passkeys (WebAuthn). Sign-in is passwordless and discoverable — the
    // authenticator resolves the account, so no email is needed up front.
    // Registering one requires being signed in already (e.g. from Settings).
    signInPasskey:   function () { return client.auth.signInWithPasskey(); },
    registerPasskey: function () { return client.auth.registerPasskey(); },

    // Data — RLS scopes every query to the current user automatically.
    // DB columns are snake_case; the app speaks camelCase, so we map across.
    loadProfile: function () {
      return client.from("profiles")
        .select("machines,logs,unit,theme,routine,day_names,org_mode,routine_lists,onboarded")
        .maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          var d = r.data;
          if (!d) return null;
          return {
            machines: d.machines, logs: d.logs, unit: d.unit, theme: d.theme,
            routine: d.routine, dayNames: d.day_names, orgMode: d.org_mode,
            routineLists: d.routine_lists, onboarded: d.onboarded,
          };
        });
    },
    saveProfile: function (userId, data) {
      return client.from("profiles").upsert({
        user_id: userId,
        machines: data.machines, logs: data.logs,
        unit: data.unit, theme: data.theme,
        routine: data.routine, day_names: data.dayNames,
        org_mode: data.orgMode, routine_lists: data.routineLists,
        onboarded: data.onboarded,
        updated_at: new Date().toISOString(),
      }).then(function (r) { if (r.error) throw r.error; });
    },
    deleteProfile: function (userId) {
      return client.from("profiles").delete().eq("user_id", userId)
        .then(function (r) { if (r.error) throw r.error; });
    },
  };
})();
