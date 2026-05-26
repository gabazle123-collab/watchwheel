-- WatchWheel — track where each user_films row came from
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- 'letterboxd' = imported from a Letterboxd export ZIP (the default; matches
--                the existing flow so all pre-existing rows are correctly
--                classified by the column default).
-- 'explore'    = added directly from the in-app Explore tab via TMDB.
-- Future values welcome (e.g. 'manual', 'shared') — text column, no enum.

alter table public.user_films
  add column if not exists added_via text default 'letterboxd';
