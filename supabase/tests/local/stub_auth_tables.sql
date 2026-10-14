-- Minimal stand-in auth tables, used only when the real GoTrue migrations are not available (see run.sh).
create table auth.users (id uuid primary key default extensions.uuid_generate_v4(), email varchar, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz, created_at timestamptz default now(), banned_until timestamptz);
create table auth.sessions (id uuid primary key default extensions.uuid_generate_v4(), user_id uuid not null);
create table auth.refresh_tokens (id bigserial primary key, user_id varchar, session_id uuid, token varchar);
