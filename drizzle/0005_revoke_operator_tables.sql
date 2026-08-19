-- Close two exposures created by the default privileges in 0002.
--
-- 0002 left this standing:
--     alter default privileges in schema public
--       grant select, insert, update, delete on tables to app_authenticated;
-- so every table created in `public` afterwards is granted to the application role
-- automatically, at creation, with nobody deciding it. rls-enabled.mjs only inspects
-- tables carrying a user_id, so a table without one is both exposed and invisible.
--
-- _migrations is the serious one. The app role held INSERT, UPDATE and DELETE on the
-- table that records which migrations ran and their checksums — so the application could
-- rewrite migration history and defeat the drift guard in lib/db/migrate.mjs, which is
-- the thing standing between us and an edited migration going unnoticed. Nothing ever
-- used that access; it was granted by default and never questioned.
--
-- exams_reprice_log holds every tenant's before/after wRVU and has no user_id, so no
-- policy scopes it. It is created on demand by scripts/ops/reprice-exams.mjs.
--
-- The blanket default privilege is deliberately LEFT IN PLACE: future tenant tables do
-- need it, and removing it would make the next migration fail in a confusing way.
-- scripts/verify/table-exposure.mjs is the guard instead — every table in public must be
-- classified tenant, shared or operator, and an unclassified one fails the build.

revoke all on public._migrations from app_authenticated;

do $$
begin
  if to_regclass('public.exams_reprice_log') is not null then
    execute 'revoke all on public.exams_reprice_log from app_authenticated';
    execute 'revoke all on public.exams_reprice_log from public';
  end if;
end $$;
