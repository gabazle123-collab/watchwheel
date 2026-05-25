-- WatchWheel — YouTube trailer cache columns
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- Adds youtube_id + trailer_checked_at to the existing film_metadata_cache
-- table. trailer_checked_at non-null + youtube_id null means "checked,
-- confirmed no trailer" (so we don't burn quota re-searching).

alter table public.film_metadata_cache
  add column if not exists youtube_id          text,
  add column if not exists trailer_checked_at  timestamptz;

create index if not exists idx_film_metadata_cache_youtube
  on public.film_metadata_cache(youtube_id)
  where youtube_id is not null;
