/* ForgeLift — Supabase auth + data layer.
 *
 * Real authentication via Supabase Auth (email + password). Each signed-in
 * user owns one row in the `profiles` table; Row Level Security ties every row
 * to auth.uid(), so the user's JWT is what grants access — the browser reads
 * and writes only its own data. See supabase/migrations/.
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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  window.ForgeLiftAuth = {
    ready: true,

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

    // Data — RLS scopes every query to the current user automatically.
    loadProfile: function () {
      return client.from("profiles").select("machines,logs,unit,theme").maybeSingle()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },
    saveProfile: function (userId, data) {
      return client.from("profiles").upsert({
        user_id: userId,
        machines: data.machines, logs: data.logs,
        unit: data.unit, theme: data.theme,
        updated_at: new Date().toISOString(),
      }).then(function (r) { if (r.error) throw r.error; });
    },
    deleteProfile: function (userId) {
      return client.from("profiles").delete().eq("user_id", userId)
        .then(function (r) { if (r.error) throw r.error; });
    },
  };
})();
