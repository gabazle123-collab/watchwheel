-- WatchWheel — store director + top-billed cast on each film
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- (Originally specced as 008_user_films_credits.sql, but 008 was already taken
--  by 008_user_films_added_via.sql, so this is 009.)
--
-- Populated at import time from TMDB credits (append_to_response=videos,credits).
-- Existing rows get backfilled on the next re-import — the user_films upsert
-- on (user_id, letterboxd_url) updates these columns rather than skipping
-- films that already exist.
--
-- director  = the crew member with job == 'Director'
-- cast_list = top 5 billed cast member names, in billing order

alter table public.user_films add column if not exists director  text;
alter table public.user_films add column if not exists cast_list text[];
