-- Shotgun — promemoria della mattina («Conferma il viaggio»).
-- Da eseguire nel SQL Editor di Supabase dopo schema.sql e dopo aver pubblicato la funzione «notify».
-- Ogni giorno alle 9:00 UTC (10:00 in Italia d'inverno, 11:00 d'estate) chiama il servizio notifiche.
-- Il segreto che autorizza la chiamata è creato da schema.sql e non lascia mai il database.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'shotgun-da-confermare';
select cron.schedule('shotgun-da-confermare', '0 9 * * *', $job$
  select net.http_post(
    url := 'https://sxyubayfhfeipubyuywy.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron', (select value from public.app_secrets where name = 'cron')),
    body := '{"type":"daily"}'::jsonb,
    timeout_milliseconds := 10000
  );
$job$);
