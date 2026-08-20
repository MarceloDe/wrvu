-- Reverses 0010. Drops the recorded state, address and principal-institution flag; the
-- institutions themselves, their site mappings and every exam attribution are untouched.
drop index if exists institutions_one_primary_per_user;
alter table institutions drop column if exists is_primary;
alter table institutions drop column if exists address;
alter table institutions drop column if exists practice_state;
