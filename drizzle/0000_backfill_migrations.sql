-- N02 production backfill. RECORDS history; runs no application DDL.
--
-- Production already has every object in 0000_baseline (it predates this migrator) and
-- the objects from 0001_llm_usage (applied BY HAND through the Neon SQL console on
-- 2026-08-18, see goals/evidence/prod-audit-log.jsonl). This file makes that history
-- explicit so the migrator can take over.
--
-- Equivalent to: node lib/db/migrate.mjs --url-env <VAR> --stamp
-- Provided as SQL because the operator runs it in the Neon console, where no
-- connection string leaves the browser.
--
-- Checksums are sha256 of the migration files as of this commit. If a checksum below
-- does not match the file on disk, DO NOT edit the file — the migrator will refuse, and
-- it is right to.
--
-- Rollback:  drop table if exists _migrations;

create table if not exists _migrations (
  name       text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);

insert into _migrations (name, checksum) values
  ('0000_baseline',  'de7a68c4a32f1c4522014e4383642221c81fae73044b493cf05a7738d01f19de'),
  ('0001_llm_usage', 'b9d4757d4eff0049419ac9092391724a11fcafd40e2f622479a5105bf3edb4b0')
on conflict (name) do nothing;

-- Verify:
--   select name, checksum, applied_at from _migrations order by name;
--   -> 0000_baseline, 0001_llm_usage
--   select tablename from pg_tables where schemaname='public' and tablename like 'llm%';
--   -> llm_rate_buckets, llm_usage   (unchanged; this file created neither)
