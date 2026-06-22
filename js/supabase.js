/* ForgeLift — Supabase data layer.
 *
 * Per-user data lives in a single `accounts` row in Supabase Postgres. The
 * browser only ever talks to four PIN-verified RPCs (fl_login / fl_signup /
 * fl_save / fl_delete); it never touches the table directly, so PIN hashes
 * stay server-side. See supabase/migrations/0001_accounts.sql.
 *
 * Loads before js/app.js, which uses window.ForgeLiftDB. */
(function () {
  "use strict";

  // Public project URL + anon key. The anon key is meant to ship in the client;
  // it grants nothing beyond calling the locked-down RPCs above.
  var SUPABASE_URL = "https://gsnmhmihngkjbklhkbju.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdzbm1obWlobmdramJrbGhrYmp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzg4NTQsImV4cCI6MjA5NzY1NDg1NH0.OQ4ZTFdwBccFr3HT7sVk_VvQBzz2YjeX6LOtMmyV1Zk";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("ForgeLift: supabase-js failed to load (offline?).");
    return;
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function rpc(fn, args) {
    return client.rpc(fn, args).then(function (res) {
      if (res.error) throw new Error(res.error.message || "request failed");
      return res.data;
    });
  }

  window.ForgeLiftDB = {
    // → {status:'new'} | {status:'ok', data:{machines,logs,unit,theme}} | {status:'bad_pin'}
    login: function (username, pin) {
      return rpc("fl_login", { p_username: username, p_pin: pin });
    },
    // → {status:'ok'} | {status:'exists'}
    signup: function (username, display, pin, data) {
      return rpc("fl_signup", {
        p_username: username, p_display: display, p_pin: pin,
        p_machines: data.machines, p_logs: data.logs,
        p_unit: data.unit, p_theme: data.theme,
      });
    },
    // → {status:'ok'} | {status:'bad_pin'} | {status:'no_account'}
    save: function (username, pin, data) {
      return rpc("fl_save", {
        p_username: username, p_pin: pin,
        p_machines: data.machines, p_logs: data.logs,
        p_unit: data.unit, p_theme: data.theme,
      });
    },
    // → {status:'ok'} | {status:'bad_pin'} | {status:'no_account'}
    remove: function (username, pin) {
      return rpc("fl_delete", { p_username: username, p_pin: pin });
    },
  };
})();
