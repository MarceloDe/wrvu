-- N00c-pwa-lock-llm-proxy — additive LLM metering tables.
--
-- Additive only: no existing table, column or type is touched, so an older
-- deploy keeps working unchanged and a rollback can leave these in place
-- (INV-ADDITIVE-CONTRACTS, and the node's own rollback note).
--
-- Rollback:
--   drop table if exists llm_rate_buckets;
--   drop table if exists llm_usage;

create table if not exists llm_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  template      text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate numeric(12, 6) not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists llm_usage_user_created_idx
  on llm_usage (user_id, created_at);

create table if not exists llm_rate_buckets (
  user_id    text primary key,
  tokens     numeric(12, 4) not null,
  updated_at timestamptz not null default now()
);
