-- N13 / D36 — specialty tags that RANK, and may never restrict.
--
-- The point of tagging is that a neuroradiologist searching "brain" should see the
-- fifteen codes they actually use before the ones they never will. The point of the
-- constraint is that all 828 codes stay reachable to everyone: a body imager covering a
-- neuro shift, a code that got tagged wrong, a study nobody anticipated. A taxonomy that
-- filters is a taxonomy that loses money the first time it is incomplete — and it will
-- be incomplete, because 475 of the 828 codes have body_region 'other'.
--
-- So this is a separate table joined for ORDERING, never a column filtered in a WHERE.
-- scripts/verify/taxonomy-never-restricts.mjs enforces that.
--
-- Derived rather than hand-curated: the rules live in
-- scripts/reference/derive-specialties.mjs and are re-runnable against any release, so a
-- new CMS extract does not arrive untagged. `source` records how a row got here, leaving
-- room for 'curated' rows later without anyone guessing which is which.

create table reference.code_specialties (
  version_id uuid not null references reference.fee_schedule_versions(id) on delete cascade,
  hcpcs      text not null,
  specialty  text not null,
  source     text not null default 'derived',
  primary key (version_id, hcpcs, specialty),
  foreign key (version_id, hcpcs)
    references reference.procedure_codes(version_id, hcpcs) on delete cascade,
  constraint specialty_known check (
    specialty in ('neuro','body','msk','breast','cardiac','vascular')
  ),
  constraint specialty_source_known check (source in ('derived','curated'))
);

create index code_specialties_lookup on reference.code_specialties (version_id, specialty);

grant select on reference.code_specialties to app_authenticated;
