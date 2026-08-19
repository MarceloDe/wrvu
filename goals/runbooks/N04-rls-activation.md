# N04 — activating RLS

RLS is installed and inert. This is the sequence that makes it real, and the order is
load-bearing: **the application must be able to declare its tenant BEFORE the
connection loses BYPASSRLS**, or every query returns zero rows and the app goes dark.

## What was established by measurement, not assumption

| Finding | Where |
|---|---|
| A GUC set in one HTTP statement does **not** leak into the next | `tenant-mechanism-probe.mjs`, real dev branch |
| `SET LOCAL` **does** hold across a `neon-http` transaction array | same |
| `neondb_owner` has `BYPASSRLS` and owns all 10 tables | same |
| A **console-created** Neon role gets `rolbypassrls = true` **and** `neon_superuser` | `app_login` on dev, 2026-08-19 |
| `neondb_owner` **cannot** revoke `neon_superuser` or clear `BYPASSRLS` | both permission-denied |
| A **SQL-created** role is clean: no BYPASSRLS, no memberships | `app_rls` on dev |

The fifth line is the one that decides the design. **Do not create the application
role in the Neon console** — it will silently ignore every policy, and `rls-enabled.mjs`
will tell you so.

## Order of operations

1. **Apply `0002_rls`.** Inert: `app_authenticated` is NOLOGIN and nothing rotates.
   `node --env-file=.env.local lib/db/migrate.mjs --url-env DATABASE_URL_UNPOOLED`
2. **Land the scoped client** (`getScopedDb`). Until this ships, a connection without
   BYPASSRLS reads nothing.
3. **Create the login role — SQL only, in the Neon SQL Editor.** Choose your own
   password; it must never enter a migration, a commit, or a command line.
   ```sql
   create role app_rls login password '<choose one>';
   grant app_authenticated to app_rls;
   ```
   On `dev` the role already exists as NOLOGIN, so there it is:
   ```sql
   alter role app_rls with login password '<choose one>';
   ```
4. **Point the connection at it.** Dev: `.env.local`. Production: a Vercel
   project-level override — the Neon integration owns `DATABASE_URL`, so the override
   must shadow it, and re-syncing the integration will clobber it.
5. **Verify, in this order.**
   ```
   node --env-file=.env.local scripts/verify/rls-enabled.mjs --url-env DATABASE_URL_UNPOOLED
   node scripts/verify/cross-tenant-probe.mjs
   npm run verify:shippable
   ```

## Rollback

Point `DATABASE_URL` back at `neondb_owner`. That alone restores the previous
behaviour — the policies go inert again without any schema change. If the policies
themselves must go, `drizzle/0002_rls.down.sql` removes them and the role.

## Cleanup

`app_login` on the dev branch is a Neon console role created while establishing the
finding above. It holds BYPASSRLS, it is not used by anything, and it should be
deleted.
