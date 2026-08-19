-- Rollback for 0007. Tags only rank, so removing them degrades ordering and nothing else.
drop table if exists reference.code_specialties;
