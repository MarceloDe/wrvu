# NeuroRVU

A multi-user, invite-only Next.js (App Router) PWA for tracking neuroradiology
productivity against CMS-2026 wRVU benchmarks. AI screenshot/camera OCR
extraction and live wRVU lookup are preserved; auth, per-user data isolation, and
a real relational database are layered on top.

## Architecture

```
Public:
  /                       Landing page (mobile-first, metal design, PWA-installable)
  /sign-in /sign-up       Clerk auth (invite-only)

Protected (Clerk middleware → middleware.js):
  /app                    NeuroRVU dashboard (camera OCR, timeline, benchmarks)
  /admin                  In-app user management (admins only)
  /api/claude             Anthropic proxy  (server-only ANTHROPIC_API_KEY, auth-gated)
  /api/store              Per-user key/value persistence (Neon)  → scoped to userId
  /api/rvu-tables         wRVU fee-schedule tables (system + user/company)

Auth:   Clerk        (Vercel Marketplace integration)
Data:   Neon Postgres (Vercel Marketplace integration) via Drizzle ORM
AI:     Anthropic Messages API (vision + web_search)
```

### Data model (`lib/db/schema.js`)
- `users` — mirror of Clerk users + app role.
- `user_kv` — per-user blobs backing `/api/store` (`nrv_log`, `nrv_baseline`, `nrv_settings`).
- `rvu_tables` / `rvu_codes` — **many** wRVU fee schedules. The seeded CMS-2026
  neuro table is `is_system = true`; future **company uploads** are the same
  shape (`owner_id` + `source = 'company-upload'`).

## One-time setup (paid, plug-and-play via Vercel Marketplace)

1. **Clerk** — Vercel project → Integrations → add **Clerk** → connect to this
   project. Injects `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`.
   In the Clerk dashboard: **Restrictions → Allowlist / "Sign-ups via invitation
   only"** to enforce invite-only access.
2. **Neon** — Vercel project → Integrations → add **Neon** → connect. Injects
   `DATABASE_URL`.
3. Add env vars: `ANTHROPIC_API_KEY` (already set) and `ADMIN_EMAILS`
   (comma-separated admin emails, e.g. `mocfelix@gmail.com`).
4. Push the schema and seed the CMS-2026 table:
   ```bash
   vercel env pull .env.local
   npm run db:push      # create tables in Neon
   npm run db:seed      # load the CMS-2026 neuro wRVU values
   ```
5. Redeploy. Invite users from `/admin` (or the Clerk dashboard).

## Local development

```bash
npm install
vercel env pull .env.local     # pulls Clerk + Neon + Anthropic vars
npm run db:push && npm run db:seed
npm run dev                    # http://localhost:3000
```

## Notes
- **PWA**: installable (`public/manifest.webmanifest` + `public/sw.js`); the
  dashboard has a **Take photo** button (`capture="environment"`) for phone OCR.
- **Admin**: `/admin` lists users, sends Clerk invitations, toggles admin role,
  and removes users. Access is granted by `ADMIN_EMAILS` or Clerk
  `publicMetadata.role = "admin"`.
- **Scale**: built for ~10 users; Clerk + Neon free/paid tiers and Vercel Fluid
  Compute handle this comfortably. Vercel **Pro** is recommended for commercial
  use and the 60s function timeout used by `/api/claude`.
- **Design**: the landing page is a self-contained component, ready to push to a
  claude.ai/design project via `/design-sync` for visual iteration.
```
