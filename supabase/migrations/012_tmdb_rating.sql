-- WatchWheel — store TMDB community rating (vote_average) alongside films
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- Populated at import / add time from TMDB's vote_average. decimal(3,1)
-- rounds to one place (e.g. 7.8), matching how it's displayed. Lets the
-- screening result show the community score next to the user's own rating.

alter table public.user_films   add column if not exists tmdb_rating decimal(3,1);
alter table public.user_watched add column if not exists tmdb_rating decimal(3,1);
