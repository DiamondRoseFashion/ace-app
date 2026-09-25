-- Meetings with no chosen reminder now remind 1 hour before start.
-- Moves everyone still on the old 30-minute default to 60 minutes.
alter table public.profiles alter column reminder_default_minutes set default 60;
update public.profiles set reminder_default_minutes = 60 where reminder_default_minutes = 30;
