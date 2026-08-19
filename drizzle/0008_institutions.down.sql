-- Rollback for 0008. The exams.institution text column was never removed, so dropping the
-- link loses no classification — the raw site string is still there.
drop index if exists exams_institution_idx;
alter table exams drop column if exists institution_id;
drop table if exists institution_sites;
drop table if exists institutions;
