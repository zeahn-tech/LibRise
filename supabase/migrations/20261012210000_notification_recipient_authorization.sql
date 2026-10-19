-- =====================================================================
-- F-18 (Medium): any signed-in user could create a notification for ANY
-- other user ("Authenticated users can create notifications for others",
-- WITH CHECK (true)). Notifications carry a title, a message and an action_url
-- and have no sender, so a forged "your payment was approved - click here"
-- was indistinguishable from a real one.
--
-- The application creates notifications client-side for many legitimate
-- recipients, so the policy is narrowed to RELATIONSHIPS instead of being
-- removed. A user may notify:
--   * themselves;
--   * a member of an organization they are also an ACTIVE member of;
--   * a participant of a conversation they are in;
--   * the other side of an application (candidate <-> members of the
--     organization the application was sent to);
--   * the other side of a business inquiry / deal-room access request
--     (sender/buyer <-> listing owner);
--   * a platform administrator (payment / verification hand-offs), and, if the
--     sender is a platform administrator, anyone.
-- In addition action_url must be NULL or a RELATIVE in-app path ("/billing"),
-- never an external link.
-- Residual risk (documented): within a legitimate relationship the content is
-- still free text; the long-term fix is to create notifications from SECURITY
-- DEFINER code/triggers and add a sender column.
-- Suspended accounts are denied by the restrictive policy from 20261012150000.
--
-- ROLLBACK: drop the new policy and re-create
--   "Authenticated users can create notifications for others" FOR INSERT TO
--   authenticated WITH CHECK (true); drop function public.can_notify_user(varchar).
-- =====================================================================
create or replace function public.can_notify_user(p_recipient varchar)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select auth.uid() is not null and p_recipient is not null and (
    p_recipient = auth.uid()::varchar
    or public.is_platform_admin(auth.uid()::varchar)
    or public.is_platform_admin(p_recipient)
    or exists (
      select 1
      from public.organization_memberships a
      join public.organization_memberships b on b.organization_id = a.organization_id
      where a.user_id = auth.uid()::varchar and a.status = 'active'
        and b.user_id = p_recipient and b.status = 'active')
    or exists (
      select 1
      from public.conversation_participants a
      join public.conversation_participants b on b.conversation_id = a.conversation_id
      where a.user_id = auth.uid()::varchar and b.user_id = p_recipient)
    or exists (
      select 1
      from public.applications ap
      join public.organization_memberships m on m.organization_id = ap.organization_id and m.status = 'active'
      where (ap.applicant_user_id = auth.uid()::varchar and m.user_id = p_recipient)
         or (ap.applicant_user_id = p_recipient and m.user_id = auth.uid()::varchar))
    or exists (
      select 1
      from public.business_listings l
      join public.business_inquiries i on i.listing_id = l.id
      where (l.owner_user_id = p_recipient and i.sender_user_id = auth.uid()::varchar)
         or (l.owner_user_id = auth.uid()::varchar and i.sender_user_id = p_recipient))
    or exists (
      select 1
      from public.business_listings l
      join public.business_access_requests r on r.listing_id = l.id
      where (l.owner_user_id = p_recipient and r.buyer_user_id = auth.uid()::varchar)
         or (l.owner_user_id = auth.uid()::varchar and r.buyer_user_id = p_recipient))
  );
$$;
revoke all on function public.can_notify_user(varchar) from public, anon;
grant execute on function public.can_notify_user(varchar) to authenticated;

drop policy if exists "Authenticated users can create notifications for others" on public.notifications;
drop policy if exists "Users can create notifications for related users" on public.notifications;
create policy "Users can create notifications for related users" on public.notifications
  for insert to authenticated
  with check (
    public.can_notify_user(recipient_user_id)
    and (action_url is null or (action_url ~ '^/[A-Za-z0-9_./?=&#%-]*$' and action_url !~ '^//'))
  );
