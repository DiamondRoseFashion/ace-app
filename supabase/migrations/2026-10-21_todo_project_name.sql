-- To-Do: keep the linked project's name on the to-do, so the person
-- doing it sees it even when they can't open that project
-- (e.g. a project from the Support page). Safe to run more than once.
alter table public.todos add column if not exists project_name text;
update public.todos t set project_name = p.name from public.projects p
where p.id = t.project_id and t.project_name is null;
