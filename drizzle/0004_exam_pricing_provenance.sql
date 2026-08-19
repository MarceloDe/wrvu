-- N14 / INV-MONEY-ONE-PATH — record WHERE each stored wRVU came from.
--
-- Until now /api/exams stored whatever number the client sent, and the two clients
-- disagreed on 54 of 61 codes. The column therefore holds a mixture with no way to tell
-- which table produced any given row. These two columns end that ambiguity for every
-- future row and label the existing ones honestly as what they are.
--
-- wrvu STAYS NOT NULL on purpose. The dashboard aggregates it with bare `+=` in a dozen
-- places, so a NULL would become NaN and silently poison every total — a worse failure
-- than the one being fixed, and invisible. Instead an unpriced code stores 0 WITH a
-- state that says why, which is honest: 0 alone was the bug, 0 plus "contractor_priced"
-- is a fact the UI can surface. Exactly one code in the current neuro set (76390) is
-- affected today.
--
-- Additive by D33b: existing clients ignore unknown JSON keys, so TestFlight builds that
-- predate this keep working unchanged.

alter table exams
  add column wrvu_state  text not null default 'legacy_client',
  add column priced_from uuid references reference.fee_schedule_versions(id);

comment on column exams.wrvu_state is
  'How the stored wrvu was produced: legacy_client (pre-N14, priced by whichever app logged it), or a price_state from the reference schema.';
comment on column exams.priced_from is
  'The fee schedule version resolveValue() used. NULL for legacy_client rows.';

alter table exams add constraint exams_wrvu_state_known check (
  wrvu_state in ('legacy_client','priced','no_physician_work','contractor_priced','not_payable','unpriced_other','unknown_code')
);

-- A server-priced row must name the release it was priced against; a legacy row must not
-- pretend to. Written NULL-safely: a CHECK only rejects FALSE, and the obvious form of
-- this passes on NULL (the same trap that let a hole into 0003).
alter table exams add constraint exams_priced_from_matches_state check (
  (wrvu_state = 'legacy_client' and priced_from is null)
  or (wrvu_state <> 'legacy_client' and priced_from is not null)
);

create index exams_wrvu_state_idx on exams (user_id, wrvu_state);
