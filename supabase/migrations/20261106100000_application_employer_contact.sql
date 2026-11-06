-- "Message employer" from an application card.
--
-- A job seeker must be able to open a chat with the employer of a vacancy they
-- applied to WITHOUT ever seeing the employer's email address. This RPC
-- resolves the employer's user id and display name on the server and returns
-- ONLY those two fields (never an email or phone number).
--
-- Authorisation: the caller must be the applicant on that application. It
-- cannot be used to look up arbitrary users.

create or replace function public.get_application_employer_contact(p_application_id character varying)
returns table (
  employer_user_id character varying,
  employer_name character varying,
  organization_name character varying,
  opportunity_title character varying
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
    select
      u.id,
      u.full_name,
      o.name,
      op.title
    from public.applications a
    join public.opportunities op on op.id = a.opportunity_id
    join public.users u on u.id = op.created_by_user_id
    left join public.organizations o on o.id = op.organization_id
    where a.id = p_application_id
      and a.applicant_user_id = auth.uid()::character varying
    limit 1;
end;
$$;

revoke all on function public.get_application_employer_contact(character varying) from public;
revoke all on function public.get_application_employer_contact(character varying) from anon;
grant execute on function public.get_application_employer_contact(character varying) to authenticated;
