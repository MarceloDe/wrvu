-- Rollback for 0002_rls.sql. Restores the pre-N04 state exactly: policies dropped,
-- RLS off, role removed. The app keeps working throughout either direction because
-- application-level user_id filtering is unchanged by this migration.
do $$
declare t text;
begin
  foreach t in array array['exams','extra_duty_periods','extra_duty_rates','user_kv','llm_usage','llm_rate_buckets']
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('alter table public.%I no force row level security', t);
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;

alter default privileges in schema public
  revoke select, insert, update, delete on tables from app_authenticated;
revoke all on all sequences in schema public from app_authenticated;
revoke all on all tables in schema public from app_authenticated;
revoke usage on schema public from app_authenticated;
drop role if exists app_authenticated;
