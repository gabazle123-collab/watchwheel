-- WatchWheel — film metadata cache (runtime + poster)
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run

create table if not exists public.film_metadata_cache (
  letterboxd_url  text        primary key,
  runtime_minutes integer,
  poster_url      text,
  cached_at       timestamptz not null default now()
);

-- This table is only read/written via the service role key (backend + Edge Functions).
-- Do not enable RLS unless you also add appropriate policies.
