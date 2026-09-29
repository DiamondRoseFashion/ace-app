-- Meetings can name a project that isn't in the Projects list
-- (typed in the meeting form). Linked projects still use project_id.
-- Safe to run more than once.
alter table public.meetings add column if not exists project_name text;
