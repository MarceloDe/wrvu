-- N06g — drop the dead `users` table.
--
-- Identity is Clerk's. /admin reads the user list from Clerk's API, every row in every
-- other table is keyed by the Clerk user id as plain text, and nothing has ever read or
-- written this table. It is drift: scope no goal claims, kept alive only by a Drizzle
-- declaration nobody removed. No foreign key references it.
--
-- The guard is the point. A DROP is irreversible and this migration will run against a
-- production database whose row count the author could not see from their machine, so it
-- refuses rather than assuming. If it ever aborts, that is the migration telling you the
-- table was NOT dead and the premise of this node is wrong.
do $$
declare n bigint;
begin
  if to_regclass('public.users') is null then
    raise notice 'users is already gone — nothing to do';
    return;
  end if;
  execute 'select count(*) from public.users' into n;
  if n > 0 then
    raise exception 'users holds % row(s); refusing to drop. Someone started using it — re-check N06g before removing this guard.', n;
  end if;
  drop table public.users;
end $$;
