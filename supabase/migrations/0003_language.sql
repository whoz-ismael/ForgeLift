-- ForgeLift — per-user interface language.
--
-- Stores the language the user picked (in onboarding or Settings). New rows
-- default to 'en'; the client falls back to the device language for anyone
-- without a saved choice. Additive and idempotent.

alter table public.profiles
  add column if not exists lang text not null default 'en';
