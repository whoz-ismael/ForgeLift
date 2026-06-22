-- ForgeLift — account storage backed by Supabase Postgres.
--
-- One row per account. Login is username + 4-digit PIN. The first login for a
-- username creates the account and sets its PIN; later logins must match it.
-- The PIN is never stored in clear text — only a bcrypt hash, server-side.
--
-- The table has RLS enabled with NO policies, so the public (anon) key cannot
-- read or write it directly through PostgREST. Every operation goes through the
-- SECURITY DEFINER functions below, which run as the table owner and verify the
-- PIN. That keeps pin hashes off the client while still allowing a build-step-
-- free, key-in-the-browser app to work.

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  username     text primary key,            -- lowercased key
  display_name text not null,               -- original-case name for the UI
  pin_hash     text not null,               -- bcrypt hash (pgcrypto crypt())
  unit         text not null default 'kg',
  theme        text not null default 'dark',
  machines     jsonb not null default '[]'::jsonb,
  logs         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.accounts enable row level security;
-- Intentionally no policies: all access is brokered by the functions below.

-- ── login ──────────────────────────────────────────────────────────────────
-- Returns {status:'new'} when the username is free (client should seed + signup),
-- {status:'ok', data:{…}} on a correct PIN, or {status:'bad_pin'} otherwise.
create or replace function public.fl_login(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec public.accounts;
begin
  select * into rec from public.accounts where username = lower(trim(p_username));
  if not found then
    return jsonb_build_object('status', 'new');
  end if;
  if rec.pin_hash = crypt(p_pin, rec.pin_hash) then
    return jsonb_build_object(
      'status', 'ok',
      'data', jsonb_build_object(
        'machines', rec.machines,
        'logs',     rec.logs,
        'unit',     rec.unit,
        'theme',    rec.theme
      )
    );
  end if;
  return jsonb_build_object('status', 'bad_pin');
end;
$$;

-- ── signup ─────────────────────────────────────────────────────────────────
-- Creates an account. {status:'exists'} if the username was taken in a race.
create or replace function public.fl_signup(
  p_username text, p_display text, p_pin text,
  p_machines jsonb, p_logs jsonb, p_unit text, p_theme text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.accounts (username, display_name, pin_hash, machines, logs, unit, theme)
  values (
    lower(trim(p_username)), p_display, crypt(p_pin, gen_salt('bf')),
    coalesce(p_machines, '[]'::jsonb), coalesce(p_logs, '{}'::jsonb),
    coalesce(p_unit, 'kg'), coalesce(p_theme, 'dark')
  );
  return jsonb_build_object('status', 'ok');
exception when unique_violation then
  return jsonb_build_object('status', 'exists');
end;
$$;

-- ── save ───────────────────────────────────────────────────────────────────
-- Replaces the account's data after verifying the PIN.
create or replace function public.fl_save(
  p_username text, p_pin text,
  p_machines jsonb, p_logs jsonb, p_unit text, p_theme text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec public.accounts;
begin
  select * into rec from public.accounts where username = lower(trim(p_username));
  if not found then
    return jsonb_build_object('status', 'no_account');
  end if;
  if rec.pin_hash <> crypt(p_pin, rec.pin_hash) then
    return jsonb_build_object('status', 'bad_pin');
  end if;
  update public.accounts set
    machines   = coalesce(p_machines, machines),
    logs       = coalesce(p_logs, logs),
    unit       = coalesce(p_unit, unit),
    theme      = coalesce(p_theme, theme),
    updated_at = now()
  where username = rec.username;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ── delete ─────────────────────────────────────────────────────────────────
create or replace function public.fl_delete(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec public.accounts;
begin
  select * into rec from public.accounts where username = lower(trim(p_username));
  if not found then
    return jsonb_build_object('status', 'no_account');
  end if;
  if rec.pin_hash <> crypt(p_pin, rec.pin_hash) then
    return jsonb_build_object('status', 'bad_pin');
  end if;
  delete from public.accounts where username = rec.username;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Only the anon/authenticated roles may call the RPCs; lock out the rest.
revoke all on function public.fl_login(text, text) from public;
revoke all on function public.fl_signup(text, text, text, jsonb, jsonb, text, text) from public;
revoke all on function public.fl_save(text, text, jsonb, jsonb, text, text) from public;
revoke all on function public.fl_delete(text, text) from public;

grant execute on function public.fl_login(text, text) to anon, authenticated;
grant execute on function public.fl_signup(text, text, text, jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.fl_save(text, text, jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.fl_delete(text, text) to anon, authenticated;
