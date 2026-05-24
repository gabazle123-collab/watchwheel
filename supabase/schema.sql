-- WatchWheel — Supabase schema v1
-- Run this in: Supabase dashboard → SQL Editor → New query → paste → Run

-- ─────────────────────────────────────────────────────────────────
-- PROFILES
-- One row per user; id mirrors auth.users.id
-- ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id                  uuid        primary key references auth.users on delete cascade,
  letterboxd_username text,
  date_joined         timestamptz not null default now(),
  digest_opt_in       boolean     not null default true,
  digest_hour         smallint    not null default 18,   -- 0–23, user's LOCAL hour
  timezone            text        not null default 'UTC', -- IANA string, e.g. 'America/New_York'
  digest_count        integer     not null default 0     -- lifetime digests sent → used for No. X in email subject
);

alter table public.profiles enable row level security;

create policy "profiles: users read own row"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: users update own row"
  on public.profiles for update
  using (auth.uid() = id);


-- ─────────────────────────────────────────────────────────────────
-- FILM HISTORY
-- Every film served to a user (from the app picker or a digest)
-- ─────────────────────────────────────────────────────────────────
create table public.film_history (
  id             bigint      generated always as identity primary key,
  user_id        uuid        not null references public.profiles on delete cascade,
  letterboxd_url text        not null,
  title          text        not null,
  year           text,
  poster_url     text,
  mood           text,
  source         text        not null default 'app', -- 'app' | 'digest'
  served_at      timestamptz not null default now()
);

alter table public.film_history enable row level security;

create policy "film_history: users read own rows"
  on public.film_history for select
  using (auth.uid() = user_id);

create policy "film_history: users insert own rows"
  on public.film_history for insert
  with check (auth.uid() = user_id);

create index film_history_user_served on public.film_history (user_id, served_at desc);


-- ─────────────────────────────────────────────────────────────────
-- DIGEST SENDS
-- One row per digest email sent. film_urls is the list of 5 films
-- included; used to enforce the 14-day repeat window.
-- Inserts come only from the Edge Function (service role bypasses RLS).
-- ─────────────────────────────────────────────────────────────────
create table public.digest_sends (
  id             bigint      generated always as identity primary key,
  user_id        uuid        not null references public.profiles on delete cascade,
  digest_number  integer     not null,   -- per-user sequence number → "No. 12" in subject
  film_urls      text[]      not null,   -- 5 Letterboxd film URLs sent
  sent_at        timestamptz not null default now()
);

alter table public.digest_sends enable row level security;

create policy "digest_sends: users read own rows"
  on public.digest_sends for select
  using (auth.uid() = user_id);

-- No user-facing insert policy — the Edge Function uses the service role key,
-- which bypasses RLS entirely.

create index digest_sends_user_sent on public.digest_sends (user_id, sent_at desc);


-- ─────────────────────────────────────────────────────────────────
-- AUTO-CREATE PROFILE ON SIGN-UP
-- Postgres trigger fires after every new row in auth.users and
-- inserts a matching profiles row with all defaults.
-- security definer + fixed search_path prevents privilege escalation.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
