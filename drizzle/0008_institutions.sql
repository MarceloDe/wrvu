-- N18 — institutions and sites as data, not two hardcoded names.
--
-- Today the app knows exactly UM, JHS and Other, baked into a 1,800-line component in 71
-- places and into a three-case Swift enum. This makes them rows. Behaviour does not change
-- in this migration: UM and JHS are seeded per user and the app keeps reading them, so the
-- dashboard shows identical numbers. What changes is that a third institution becomes
-- possible without a code edit.
--
-- INV-SITE-NEVER-FAILS is enforced here rather than hoped for. Every user has exactly one
-- default institution — the bucket an unrecognised site falls into — guaranteed by a
-- partial unique index plus the seed. Losing a study because its site was not recognised
-- is the failure that must not happen: the doctor did the work either way.
--
-- ytd_wrvu replaces settings.umYTD / settings.jhsYTD, the two scalars the reported total
-- is split by. It is 0 here and the UI still reads the old scalars; moving that read is
-- the next change, and doing it separately keeps this migration behaviour-identical.

create table institutions (
  id          uuid primary key default gen_random_uuid(),
  user_id     text        not null,
  name        text        not null,   -- stable key, matches today's 'UM' / 'JHS' / 'Other'
  label       text        not null,   -- 'UHealth / UM'
  short_label text        not null,   -- 'UM'
  color       text,
  ytd_wrvu    numeric(12,2) not null default 0,
  sort_order  integer     not null default 0,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- Exactly one default per user. Without this, an unmapped site has nowhere to go, or two
-- places to go, and the analytics silently disagree with themselves.
create unique index institutions_one_default_per_user
  on institutions (user_id) where is_default;

-- A site string the user has mapped to an institution. This generalises the iOS
-- `nrv_sites` override map, which already works this way — the PWA was the side still
-- using regexes hardcoded in source.
create table institution_sites (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  institution_id uuid not null references institutions(id) on delete cascade,
  pattern        text not null,   -- matched case-insensitively against the raw site
  created_at     timestamptz not null default now(),
  unique (user_id, pattern)
);

-- Exams gain a link. The text column stays: it is the raw site as captured, and it is how
-- a re-classification can be re-derived later. Nullable because a row written before its
-- institution existed is still a valid row.
alter table exams add column institution_id uuid references institutions(id);
create index exams_institution_idx on exams (user_id, institution_id);

-- Tenant tables: same treatment as every other, from the first line rather than retrofitted.
alter table institutions        enable row level security;
alter table institutions        force  row level security;
alter table institution_sites   enable row level security;
alter table institution_sites   force  row level security;

create policy tenant_isolation on institutions
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));
create policy tenant_isolation on institution_sites
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));
