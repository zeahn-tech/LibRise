-- Push new notifications to the recipient's open app instantly.
--
-- The app already works without this (it polls every 30s and refreshes on tab
-- focus), but adding the table to the realtime publication makes the bell
-- count and panel update the moment a notification is created.
--
-- Realtime applies the table's row-level security, so a user is only ever
-- pushed rows where recipient_user_id = their own id (policy: "Recipients can
-- view their own notifications"). Idempotent and safe to re-run.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
