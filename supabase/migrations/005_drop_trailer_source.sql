-- WatchWheel — drop trailer_source column
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- The Letterboxd scrape tier was removed from the trailer waterfall, so we
-- no longer need to track which tier produced each cached video. The two
-- remaining sources (youtube_trailer / youtube_teaser) are tracked in-memory
-- per request for batch-summary logging only — no need to persist them.

alter table public.film_metadata_cache
  drop column if exists trailer_source;
