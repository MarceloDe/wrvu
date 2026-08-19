-- Rollback for 0004. Drops provenance only; no stored wrvu changes.
drop index if exists exams_wrvu_state_idx;
alter table exams drop constraint if exists exams_priced_from_matches_state;
alter table exams drop constraint if exists exams_wrvu_state_known;
alter table exams drop column if exists priced_from;
alter table exams drop column if exists wrvu_state;
