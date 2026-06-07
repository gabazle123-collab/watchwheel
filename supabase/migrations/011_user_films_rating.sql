-- WatchWheel — personal Letterboxd rating on watchlist films
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- A film can be on the watchlist AND already rated (e.g. a rewatch you want
-- to revisit). Populated from ratings.csv during import; lets the picker /
-- Library show "★ your rating" on watchlist cards.

alter table public.user_films
  add column if not exists user_rating decimal(3,1);
