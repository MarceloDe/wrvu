-- N11 — the versioned `reference` schema: ONE place both apps price from.
--
-- Today the same study is priced differently on iPhone and in the browser, because the
-- PWA carries a hand-curated 61-code table and iOS carries the 828-code CMS extract.
-- 55 of those 61 codes disagree. This schema ends that by making the CMS release the
-- only pricing source, addressable by version.
--
-- GRAIN is (hcpcs, modifier) — '', '26', 'TC'. A technical-component row genuinely has
-- no physician work, so it is not an error to be smoothed over; it is a distinct fact.
--
-- price_state is the column that matters, and the CHECK constraint below is why it is
-- here rather than in application code. Three different facts used to collapse into the
-- number 0: no physician work (TC), contractor-priced (status C, where CMS publishes no
-- national value and 0 UNDERSTATES real pay), and not payable at all. The old table
-- papered over the middle case by inventing 1.43–2.2 and flagging est:true — an
-- estimate presented as fact. The constraint makes both mistakes unrepresentable: a row
-- claiming to be priced must carry a positive work RVU, and a row with no national value
-- must carry NULL, never a number.

create schema if not exists reference;

create table reference.fee_schedule_versions (
  id                 uuid primary key default gen_random_uuid(),
  source_release     text        not null,
  source_file        text,
  source_url         text,
  source_year        integer     not null,
  source_sha256      text        not null,
  slim_sha256        text        not null,
  conversion_factor  numeric(10,4) not null,
  loaded_at          timestamptz not null default now(),
  is_current         boolean     not null default false,
  unique (source_release, source_sha256)
);

-- Exactly one current version, enforced by the database rather than by convention.
create unique index fee_schedule_one_current
  on reference.fee_schedule_versions ((is_current)) where is_current;

create table reference.procedure_codes (
  version_id       uuid not null references reference.fee_schedule_versions(id) on delete cascade,
  hcpcs            text not null,
  descriptor       text,            -- D14-v3: descriptors stay, the MVP already ships them
  modality         text,
  body_region      text,
  contrast_status  text,
  primary key (version_id, hcpcs)
);

create table reference.code_rvus (
  version_id           uuid not null references reference.fee_schedule_versions(id) on delete cascade,
  hcpcs                text not null,
  modifier             text not null,          -- '' (global) | '26' (professional) | 'TC'
  work_rvu             numeric(8,2),           -- NULL when CMS publishes no national value
  price_state          text not null,
  status_code          text not null,
  pctc_indicator       text,
  global_days          text,
  facility_pe_rvu      numeric(8,2),
  non_facility_pe_rvu  numeric(8,2),
  malpractice_rvu      numeric(8,2),
  primary key (version_id, hcpcs, modifier),
  foreign key (version_id, hcpcs)
    references reference.procedure_codes(version_id, hcpcs) on delete cascade,
  constraint price_state_known check (
    price_state in ('priced','no_physician_work','contractor_priced','not_payable','unpriced_other')
  ),
  -- The invariant, in the one place no application can route around it.
  --
  -- The `is not null` guards are load-bearing, not defensive noise. A CHECK constraint
  -- only rejects FALSE, and in three-valued logic `NULL > 0` is NULL — so the obvious
  -- form of this constraint ACCEPTED a row claiming price_state='priced' while carrying
  -- no work RVU at all. Caught by trying it rather than by reading it.
  constraint work_rvu_matches_state check (
    (price_state = 'priced'            and work_rvu is not null and work_rvu > 0) or
    (price_state = 'no_physician_work' and work_rvu is not null and work_rvu = 0) or
    (price_state in ('contractor_priced','not_payable','unpriced_other') and work_rvu is null)
  )
);

create index code_rvus_hcpcs_idx on reference.code_rvus (hcpcs, modifier);

-- Reference data is global and read-only to the application role. It carries no
-- user_id, so it is deliberately outside the RLS policies in 0002.
grant usage on schema reference to app_authenticated;
grant select on all tables in schema reference to app_authenticated;
alter default privileges in schema reference grant select on tables to app_authenticated;
