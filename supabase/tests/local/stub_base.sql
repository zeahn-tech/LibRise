-- Supabase stand-ins WITHOUT the auth tables (roles, extensions, auth.uid()/role()/jwt(), realtime publication).
do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role','supabase_admin'] loop if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if; end loop; end $$;
create schema if not exists extensions; create schema if not exists auth;
create extension "uuid-ossp" with schema extensions;
create extension pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, public;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('role', true) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create publication supabase_realtime;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'pw'; end if; end $$; grant anon, authenticated, service_role to authenticator;

-- Real Supabase: objects created by the migration role get EXPLICIT grants to the API roles through
-- default privileges (in addition to the PostgreSQL default PUBLIC EXECUTE on functions). Without this,
-- a local run cannot see functions that are executable by anon/authenticated only because of these grants.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- Minimal Supabase Storage stand-in (the messaging-attachments migration needs storage.buckets/objects).
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;
