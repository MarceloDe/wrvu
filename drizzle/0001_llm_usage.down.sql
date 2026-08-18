-- Rollback for 0001_llm_usage. Matches the header of 0001_llm_usage.sql.
-- Additive migration, so the rollback is a clean drop: no application table,
-- column or row is touched by either direction.
drop table if exists llm_rate_buckets;
drop table if exists llm_usage;
