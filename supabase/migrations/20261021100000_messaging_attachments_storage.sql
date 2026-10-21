-- Messaging: private attachment storage + server-side unread/last-message bookkeeping.
--
-- Why:
--  1. Attachments were stored as base64 data URLs inside direct_messages.attachments (jsonb). That bloats
--     every message row/list query and makes downloads/previews unreliable. Files now live in a PRIVATE
--     Storage bucket; the message row only keeps metadata + the object path.
--  2. The client tried to bump the RECIPIENT's conversation_participants.unread_count, but RLS only lets a
--     user update their own participant row, so unread counts never moved. A trigger now does it
--     atomically, together with conversations.last_message*.
--
-- Idempotent. Additive only: legacy messages with inline data URLs keep rendering.

-- 1. Private bucket (10 MB cap, allow-listed types only) ------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments', 'message-attachments', false, 10485760,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object path convention: <conversation_id>/<message_id>/<file_name>
-- Only participants of that conversation may upload to / read from its folder. No update/delete policy:
-- attachments are immutable once sent.
drop policy if exists "Participants can upload message attachments" on storage.objects;
create policy "Participants can upload message attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1]::character varying, auth.uid()::character varying)
  );

drop policy if exists "Participants can read message attachments" on storage.objects;
create policy "Participants can read message attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and public.is_conversation_participant((storage.foldername(name))[1]::character varying, auth.uid()::character varying)
  );

-- 2. Server-side last-message + unread bookkeeping --------------------------------------------------
create or replace function public.on_direct_message_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.conversations
     set last_message = case
           when btrim(new.body) <> '' then left(new.body, 500)
           when jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0 then 'Attachment'
           else ''
         end,
         last_message_at = new.created_at,
         last_sender_id = new.sender_id,
         updated_at = now()
   where id = new.conversation_id;

  update public.conversation_participants
     set unread_count = unread_count + 1
   where conversation_id = new.conversation_id
     and user_id = new.recipient_id;

  return new;
end;
$$;

revoke all on function public.on_direct_message_inserted() from public, anon, authenticated;

drop trigger if exists trg_on_direct_message_inserted on public.direct_messages;
create trigger trg_on_direct_message_inserted
  after insert on public.direct_messages
  for each row execute function public.on_direct_message_inserted();
