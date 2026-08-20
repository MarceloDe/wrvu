-- Recreates the shape 0009 dropped. It cannot restore rows, but there were none:
-- 0009 refuses to run against a non-empty table.
create table if not exists public.users (
  id         text primary key,
  email      text,
  first_name text,
  last_name  text,
  role       text not null default 'user',
  created_at timestamptz not null default now()
);
