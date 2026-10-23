-- Hardening (audit finding #4 note): Supabase grants every API role the full table privilege set by
-- default, including TRUNCATE (which bypasses RLS), REFERENCES and TRIGGER. PostgREST never uses
-- them, so removing them narrows the blast radius of any direct-SQL path without changing behaviour.
-- Idempotent.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
