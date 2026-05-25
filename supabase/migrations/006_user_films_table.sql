-- WatchWheel — user_films table for Letterboxd import + TMDB metadata
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- One row per (user, Letterboxd film). Populated by the /import/letterboxd
-- endpoint when a user uploads their Letterboxd export ZIP. Replaces the
-- old in-memory state.watchlist sourced from scraping.

create table if not exists public.user_films (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete cascade,
  tmdb_id         int,
  title           text not null,
  year            int,
  letterboxd_url  text,
  poster_url      text,
  runtime         int,
  synopsis        text,
  genres          text[],
  youtube_id      text,
  status          text default 'pending',  -- 'pending' | 'ready' | 'unmatched'
  created_at      timestamptz default now()
);

create index if not exists user_films_user_id_idx
  on public.user_films(user_id);

-- Dedupe re-imports: same (user, letterboxd_url) → upsert, no duplicates
create unique index if not exists user_films_unique_per_user_idx
  on public.user_films(user_id, letterboxd_url);

-- RLS: users can only see / write their own films
alter table public.user_films enable row level security;

create policy "Users view own films"
  on public.user_films for select
  using (auth.uid() = user_id);

create policy "Users insert own films"
  on public.user_films for insert
  with check (auth.uid() = user_id);

create policy "Users update own films"
  on public.user_films for update
  using (auth.uid() = user_id);

create policy "Users delete own films"
  on public.user_films for delete
  using (auth.uid() = user_id);
