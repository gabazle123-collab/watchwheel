-- WatchWheel — imports table for tracking Letterboxd-import progress
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
--
-- One row per import job. The backend updates processed_count + matched_count
-- as it walks the CSV; the frontend polls /import/:importId/status for the
-- progress bar. Once status='complete' the frontend reloads user_films and
-- navigates to home.

create table if not exists public.imports (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references public.profiles(id) on delete cascade,
  status                text default 'processing',  -- 'processing' | 'complete' | 'failed'
  total_count           int,
  processed_count       int default 0,
  matched_count         int default 0,
  last_processed_title  text,
  error_message         text,
  created_at            timestamptz default now()
);

create index if not exists imports_user_id_idx
  on public.imports(user_id);

-- RLS: users can only see / write their own import jobs
alter table public.imports enable row level security;

create policy "Users view own imports"
  on public.imports for select
  using (auth.uid() = user_id);

create policy "Users insert own imports"
  on public.imports for insert
  with check (auth.uid() = user_id);

create policy "Users update own imports"
  on public.imports for update
  using (auth.uid() = user_id);
