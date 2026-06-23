-- ForgeLift — plan organisation + onboarding.
--
-- Extends the per-user profile with the workout plan (weekday assignments and
-- named routine lists), the chosen organisation mode, and an onboarded flag so
-- returning users skip the first-run setup. Additive and idempotent: existing
-- rows keep their machines/logs and pick up sensible defaults.

alter table public.profiles
  add column if not exists routine       jsonb   not null default '{}'::jsonb,
  add column if not exists day_names     jsonb   not null default '{}'::jsonb,
  add column if not exists routine_lists jsonb   not null default '[]'::jsonb,
  add column if not exists org_mode      text    not null default 'week',
  add column if not exists onboarded     boolean not null default false;
