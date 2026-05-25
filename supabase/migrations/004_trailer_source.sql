-- WatchWheel — track which tier of the trailer waterfall found each video
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- Values: 'letterboxd', 'youtube_trailer', 'youtube_teaser', or null.
-- Useful for debugging the discovery pipeline and tuning future tiers.

alter table public.film_metadata_cache
  add column if not exists trailer_source text;
