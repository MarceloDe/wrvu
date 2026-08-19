-- Rollback for 0003. The app does not read this schema until N14 lands resolveValue(),
-- so dropping it is safe while that is still true.
alter default privileges in schema reference revoke select on tables from app_authenticated;
drop schema if exists reference cascade;
