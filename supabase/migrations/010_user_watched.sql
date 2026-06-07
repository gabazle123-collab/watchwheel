-- WatchWheel — films the user has already watched (from Letterboxd export)
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- Populated at import time from watched.csv (+ ratings.csv / reviews.csv for
-- the personal rating and review text). Separate from user_films (the
-- watchlist) so "seen" history and "want to see" stay distinct.

create table if not exists public.user_watched (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tmdb_id         int,
  title           text not null,
  year            int,
  letterboxd_url  text,
  poster_url      text,
  user_rating     decimal(3,1),
  watched_date    date,
  review          text,
  director        text,
  cast_list       text[],
  genres          text[],
  synopsis        text,
  runtime_minutes int,
  youtube_id      text,
  created_at      timestamp default now()
);

create index if not exists user_watched_user_id on public.user_watched(user_id);
create unique index if not exists user_watched_unique
  on public.user_watched(user_id, letterboxd_url);

alter table public.user_watched enable row level security;

drop policy if exists "users see own watched" on public.user_watched;
create policy "users see own watched" on public.user_watched
  for all using (auth.uid() = user_id);
