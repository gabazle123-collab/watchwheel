-- WatchWheel — hourly digest cron job
-- Run in: Supabase dashboard → SQL Editor → New query → paste → Run
-- Do this AFTER deploying the Edge Function and setting its secrets.
--
-- Replace YOUR_CRON_SECRET below with the same random string you used
-- as the CRON_SECRET Edge Function secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'watchwheel-hourly-digest',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://myavvindcywasqstoaze.supabase.co/functions/v1/send-digest',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer YOUR_CRON_SECRET',
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- To verify it scheduled correctly:
-- select * from cron.job;

-- To remove it later:
-- select cron.unschedule('watchwheel-hourly-digest');
