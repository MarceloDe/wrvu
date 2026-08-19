# N04 — activating RLS

> **DONE on production, 2026-08-19.** `fella.cc` connects as `app_rls` with RLS
> enforced; `GET /api/health` returns `{"dbRole":"app_rls","rlsEnforced":true}`.
> What follows is the record of how, and the rollback.

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
| A console **password RESET** on a SQL-created role leaves it clean | `app_rls` on dev |
| Neon refuses to reset a password on a role that has none | `cannot update password for role without password` |
| Production had **no `_migrations` table** — the N02 backfill had never run | precheck on main |

The fifth line is the one that decides the design. **Do not create the application
role in the Neon console** — it will silently ignore every policy, and `rls-enabled.mjs`
will tell you so.

## Order of operations

1. **Apply `0002_rls`.** Inert: `app_authenticated` is NOLOGIN and nothing rotates.
   `node --env-file=.env.local lib/db/migrate.mjs --url-env DATABASE_URL_UNPOOLED`
2. **Land the scoped client.** DONE — `withTenant(userId, fn)` in `lib/db/index.js`.
   The old `getDb()`/`getSql()` were renamed to `getUnscopedDb()`/`getUnscopedSql()` on
   purpose: every call site had to be visited and classified, and a new one cannot reach
   tenant data by accident. Proven by `scoped-db-probe.mjs`, 8/8 against real Neon as
   `app_rls`.
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
   node --env-file=.env.local scripts/verify/rls-enabled.mjs --url-env DATABASE_URL_RLS_UNPOOLED
   node --env-file=.env.local scripts/verify/cross-tenant-probe.mjs --live
   node --env-file=.env.local scripts/verify/scoped-db-probe.mjs
   npm run verify:shippable
   ```
   `verify:shippable` alone is NOT sufficient here and never will be: it passes while
   every tenant query returns zero rows, because it never connects as the restricted
   role. `scoped-db-probe.mjs` is the one that would catch a broken rotation.
   ```
   ```

## Rollback

Point `DATABASE_URL` back at `neondb_owner`. That alone restores the previous
behaviour — the policies go inert again without any schema change. If the policies
themselves must go, `drizzle/0002_rls.down.sql` removes them and the role.

## Cleanup

`app_login` on the dev branch is a Neon console role created while establishing the
finding above. It holds BYPASSRLS, it is not used by anything, and it should be
deleted.


## How the production credential reached Vercel without passing through a transcript

Neon's console reset refuses on a role with no password, and a SQL-created role starts
without one. So Postgres generated a throwaway inside a `DO` block — seen by nobody,
never used in a connection string — purely to satisfy that precondition. The console
reset then replaced it with one Neon manages, the Connect dialog produced the full
pooled connection string, and it went clipboard → `vercel env add` stdin. It was never
printed, never in `argv`, and never in a transcript.

## Residual hazard, and what makes it visible

The Neon integration owns `DATABASE_URL`. A re-sync will clobber the override, and
`lib/db` falls back to `POSTGRES_URL`, which still points at the owner — the app would
keep working perfectly while every policy went inert. `GET /api/health` now answers
**503** with `rlsEnforced:false` if that ever happens. That is the only thing standing
between a silent control failure and noticing it.
