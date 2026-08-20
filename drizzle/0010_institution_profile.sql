-- N33 — the fields onboarding asks a new user for.
--
-- Onboarding collects a PRINCIPAL institution: the place you mostly work, with its state
-- and street address. None of that has anywhere to live today — `institutions` carries
-- name/label/short_label/color/ytd_wrvu/sort_order/is_default and nothing else, and the
-- `users` table that might have held a profile was dropped in 0009 because identity is
-- Clerk's.
--
-- TWO FLAGS, NOT ONE. `is_default` already exists and means "where a site nobody mapped
-- lands" (INV-SITE-NEVER-FAILS). It does NOT mean "my employer". Overloading it would
-- silently move every unrecognised study the moment a user named their principal
-- institution. `is_primary` is the new, separate idea, and it is optional: a user with no
-- principal institution is a normal user, whereas a user with no default is a broken one.
-- Hence a partial unique index (at most one) rather than the "exactly one" the default has.
--
-- `practice_state`, not `state`: reference.code_rvus.price_state already exists and means
-- priced / not_payable / contractor_priced. A bare `state` column here would read as that.
--
-- NOTHING IS VALIDATED AND NOTHING IS REQUIRED. D35 — every field has a working default
-- and no step is a wall. A user who skips this screen is not in a degraded state; they
-- simply have no principal institution recorded.
--
-- This does NOT derive a CMS locality. reference/ has no locality table and
-- N10-locality-extension is blocked on the CMS GPCI addendum; the state is captured now so
-- that node has something to work from later (G4.4 stays open until then).
--
-- No grant statement: 0002 leaves standing default privileges on schema public, and RLS
-- comes from the tenant_isolation policies 0008 already put on this table.
alter table institutions add column practice_state text;
alter table institutions add column address        text;
alter table institutions add column is_primary     boolean not null default false;

create unique index institutions_one_primary_per_user
  on institutions (user_id) where is_primary;
