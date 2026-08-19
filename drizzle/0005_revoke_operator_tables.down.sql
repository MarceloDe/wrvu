-- Rollback for 0005. Restores the default-privilege grants these tables received at
-- creation. Reversing this re-exposes migration history to the application role.
grant select, insert, update, delete on public._migrations to app_authenticated;
do $$
begin
  if to_regclass('public.exams_reprice_log') is not null then
    execute 'grant select, insert, update, delete on public.exams_reprice_log to app_authenticated';
  end if;
end $$;
