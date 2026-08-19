-- Rollback for 0006. Recreates the STRUCTURE only.
--
-- The 62 rows are not here. They are on branch pre-drop-legacy-rvu-20260819
-- (br-holy-hill-atdxggns), and they are superseded CMS values that disagree with the
-- current release on 54 of 61 codes — restoring them into a table named rvu_codes is
-- almost certainly the wrong thing to want. Reach for the reference schema instead.

create table if not exists rvu_tables (
  id                uuid primary key default gen_random_uuid(),
  owner_id          text,
  name              text not null,
  source            text not null default 'custom',
  year              integer,
  conversion_factor numeric,
  is_system         boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists rvu_codes (
  id          uuid primary key default gen_random_uuid(),
  table_id    uuid not null references rvu_tables(id) on delete cascade,
  cpt         text not null,
  modality    text,
  region      text,
  description text,
  contrast    text,
  wrvu        numeric not null,
  meta        jsonb
);
create index if not exists rvu_codes_table_idx on rvu_codes (table_id);
