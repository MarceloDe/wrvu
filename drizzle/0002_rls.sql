-- N04 — Row Level Security on every tenant table.
--
-- Tenant identity arrives as the GUC `app.user_id`, set with SET LOCAL inside the
-- transaction that runs the query. Verified against the real Neon dev branch
-- (scripts/verify/tenant-mechanism-probe.mjs): a GUC set by one HTTP statement does
-- NOT leak into the next, and SET LOCAL DOES hold across the statements of a
-- neon-http transaction array. That combination is what makes this predicate safe
-- on a stateless driver.
--
-- `current_setting(..., true)` returns NULL rather than raising when the GUC is
-- unset, so an un-scoped connection reads NOTHING instead of erroring. Reading
-- nothing is the fail-closed direction.
--
-- FORCE is required, not optional: without it the table owner is exempt and every
-- policy here is decorative for the role that owns the schema.
--
-- This migration does NOT create a login role and does NOT rotate any connection
-- string. It creates the privilege-bearing role `app_authenticated`, which is
-- deliberately NOLOGIN: the login role and its password are an operator action in
-- the Neon console, and a password must never live in a committed migration.

create role app_authenticated nologin;

grant usage on schema public to app_authenticated;
grant select, insert, update, delete on all tables in schema public to app_authenticated;
grant usage, select on all sequences in schema public to app_authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_authenticated;

-- Tenant tables: every row belongs to exactly one Clerk user id.
do $$
declare t text;
begin
  foreach t in array array['exams','extra_duty_periods','extra_duty_rates','user_kv','llm_usage','llm_rate_buckets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($f$
      create policy tenant_isolation on public.%I
        using (user_id = current_setting('app.user_id', true))
        with check (user_id = current_setting('app.user_id', true))
    $f$, t);
  end loop;
end $$;

-- Reference data is global and read-only to the app role. rvu_tables/rvu_codes carry
-- no user_id; scoping them by tenant would empty the fee schedule for everyone.
-- `users` mirrors Clerk and is written only by the admin path, never by a tenant.
revoke insert, update, delete on public.rvu_tables, public.rvu_codes, public.users
  from app_authenticated;
