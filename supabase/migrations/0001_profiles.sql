-- ForgeLift — per-user workout data backed by Supabase Auth.
--
-- Authentication is handled by Supabase Auth (Apple / Google OAuth or
-- email + password). Each authenticated user owns exactly one row in this
-- table, keyed by their auth user id. Row Level Security ties every row to
-- auth.uid(), so the user's JWT is what grants access — the browser can only
-- ever read or write its own row, enforced by Postgres rather than app code.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  machines   jsonb not null default '[]'::jsonb,
  logs       jsonb not null default '{}'::jsonb,
  unit       text  not null default 'kg',
  theme      text  not null default 'dark',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user may only see and modify their own row.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
