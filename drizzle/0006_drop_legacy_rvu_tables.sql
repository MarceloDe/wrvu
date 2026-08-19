-- N17 finish — drop the legacy rvu_tables / rvu_codes.
--
-- These held the CMS-2026 seed: one system table and 61 codes, loaded by the old
-- scripts/seed.mjs from lib/data/cms2026-neuro.js. Both of those are gone, and so is
-- app/api/rvu-tables, the only route that ever read them — it had no callers anywhere,
-- including iOS. The reference schema (828 codes, 2164 rows, straight from CMS RVU26A)
-- replaced them, and resolveValue() is the only thing that prices anything now.
--
-- Checked on production before writing this, not assumed:
--   rvu_tables  1 row,  0 user-owned, 1 system, source CMS-2026
--   rvu_codes  61 rows, all belonging to that one system table
--   the only foreign key pointing at either is rvu_codes -> rvu_tables
-- A user-owned row would have been a colleague's uploaded company schedule, and dropping
-- that is destroying their work rather than cleaning up. There were none.
--
-- Left behind, these are a trap rather than clutter: 61 stale prices that disagree with
-- CMS on 54 codes, sitting in a table whose name suggests it is authoritative.
--
-- Snapshot: branch pre-drop-legacy-rvu-20260819 (br-holy-hill-atdxggns), auto-delete
-- Never. That is where the rows are if they are ever wanted again — the down migration
-- restores the STRUCTURE, not the data.

drop table if exists rvu_codes;
drop table if exists rvu_tables;
