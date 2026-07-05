# NeuroRVU

A multi-user, invite-only Next.js (App Router) PWA for tracking neuroradiology
productivity against CMS-2026 wRVU benchmarks. Doctors upload daily worklist
screenshots; AI (Claude vision) extracts each study, looks up its wRVU, and the
app reconciles the running total against monthly/annual benchmarks per
institution (UHealth / UM vs Jackson / JHS).

- **Live:** https://fella.cc  (Vercel alias `https://project-m6jfw-brainsty.vercel.app`)
- **Repo:** `MarceloDe/wrvu`  ·  **Vercel project:** `brainsty/project-m6jfw`
- **Status:** Production (Clerk production instance on `fella.cc`, Vercel Pro, Neon Postgres)

---

## User manual

Access is **invite-only**. You receive an email + password from an admin (or an
invite). Everyone **signs in** at https://fella.cc — do **not** use "Sign up".

### Tabs

| Tab | What it does |
|-----|--------------|
| **Tracker** | Home dashboard. KPIs (tracked this month, YTD, annual projection, comp value), institution split, and the **"Log a session"** box to upload screenshots or quick-add by CPT. |
| **Timeline** | Two views: your **reported monthly baseline** (authoritative, editable) reconciled with your **tracked logs**, plus the **Tracked explorer** — pick a start/finish date, toggle **weekly/monthly**, and see stats (total, avg/period vs target, avg/active day, UM/JHS split) with a chart. |
| **Exams** | Every logged exam (one row per study), searchable; delete by day/batch. |
| **Uploads** | Manage upload batches/clusters; delete a whole day's upload. |
| **Codes** | Look up any CMS-2026 neuro CPT and its wRVU. |
| **Admin** | (admins only) Create users directly (email + password, no email needed), invite/allowlist, set roles, remove users. |

### Logging productivity
1. On **Tracker → Log a session**, drop or photograph a worklist/RVU-report
   screenshot. Claude extracts each study, its CPT, exam date, site, and wRVU.
2. Review the detected rows (assign a CPT to anything unpriced), then **Save**.
   Each exam is stored on its **own exam date**, so KPIs bucket by service date.
3. Or **quick-add** a study by typing a CPT / name / modality.

### Key concepts
- **Tracked** = your daily screenshot logs (granular). **Reported** = your FY26
  monthly baseline entered in Timeline (authoritative). They measure the same
  work at different resolutions and are shown side-by-side, never summed.
- KPIs use your **local** calendar (Miami/Eastern), not UTC.
- Institution split: UM/UHealth → UM, Jackson/JHS/JHM → JHS.
- Not official billing advice.

> A richer illustrated user manual exists as a separate claude.ai artifact. Paste
> its URL in an issue/PR to embed or link it here.

---

## Architecture

```
Browser (PWA on fella.cc)
   |  loads Clerk.js from  clerk.fella.cc  (Frontend API, pk_live)  -> sign-in/up, session
   |  app shell + API calls
   v
Vercel  (Next.js 14 App Router - Node.js functions - project-m6jfw - Pro)
   |- middleware.js  Clerk session gate (redirect /sign-in, or 401 for /api)
   |- /app  /admin   server-rendered pages (Clerk auth())
   \- /api/*          serverless functions:
        |- verify session / manage users -> Clerk Backend API  (api.clerk.com, sk_live)
        |- read/write data               -> Neon Postgres      (DATABASE_URL, Drizzle)
        \- OCR / lookups                 -> Anthropic Messages API (api.anthropic.com)

Clerk (production, Pro) -> sends auth email from  clkmail.fella.cc  (DKIM: clk._domainkey / clk2._domainkey)
```

### Services

| Service | Role | URL / identifier |
|---------|------|------------------|
| **Vercel** | Hosting, serverless functions, env, domains, deploys | project `brainsty/project-m6jfw`; app `https://fella.cc` |
| **Clerk** (Pro, production) | Auth, users, sessions, invites/allowlist | Frontend API `https://clerk.fella.cc`; Backend API `https://api.clerk.com`; account portal `https://accounts.fella.cc` |
| **Neon Postgres** | Relational data (Drizzle ORM) | injected `DATABASE_URL` (Vercel Marketplace integration) |
| **Anthropic** | Claude vision OCR + wRVU reasoning | `https://api.anthropic.com/v1/messages` |
| **Squarespace** | DNS registrar for `fella.cc` | Custom records hold Vercel A + 5 Clerk CNAMEs |

### Data model (`lib/db/schema.js`)
- `users` — mirror of Clerk users + app role.
- `user_kv` — per-user blobs backing `/api/store` (`nrv_baseline`, `nrv_settings`).
- `exams` — **source of truth**, one row per study (`user_id`, `batch_id`,
  `exam_date`, `cpt`, `procedure`, `site`, `institution`, `modality`, `wrvu`,
  `estimated`, `uploaded_at`).
- `rvu_tables` / `rvu_codes` — **many** wRVU fee schedules. CMS-2026 neuro table
  is `is_system = true`; future company uploads share the shape (`owner_id` +
  `source = 'company-upload'`).

---

## API endpoints

All under `app/api/`. `runtime = "nodejs"`. Auth column: **session** = requires a
signed-in Clerk user (`auth()`); **token** = requires `x-setup-token: $SETUP_TOKEN`;
**public** = whitelisted in `middleware.js`.

| Endpoint | Auth | Methods & purpose |
|----------|------|-------------------|
| `/api/health` | public | `GET` -> `{ok, db, anthropic, clerk}` booleans (no secrets). |
| `/api/exams` | session | `GET` all (or `?batches=1` summaries); `POST {batchId, exams[]}` bulk insert; `DELETE ?batchId= \| examDate= \| uploadDate= \| id=`. |
| `/api/store` | session | Per-user key/value in `user_kv`. `GET ?key=`; `POST {key,value}`; `DELETE ?key=`. |
| `/api/rvu-tables` | session | `GET` list (system + owned); `GET ?tableId=` codes; `POST {name,codes}` create a table. |
| `/api/claude` | session | `POST {messages, system, tools, maxTokens}` -> proxy to Anthropic (key stays server-side). Preserves vision + web_search. |
| `/api/setup` | token | `POST`/`GET` DDL (create tables) + seed CMS-2026; `?inspect=1` shows per-user `user_kv` isolation. |
| `/api/setup-clerk` | token | Clerk Backend-API admin: `?inspect=1` restrictions/invites/allowlist; `?user=email` diagnose an account; `POST` enable allowlist + allowlist/invite `ADMIN_EMAILS`; `?action=create-user`; `?action=fix-user` (reset password / clear lockout / verify email). |
| `/api/ocr-test` | token | `POST {media_type,data}` test the OCR extraction/validation prompt on an image. |

Server actions (`app/admin/actions.js`, admin-gated): `inviteUser`,
`createUser`, `revokeInvitation`, `setRole`, `deleteUser`.

---

## Clerk

- **Middleware** (`middleware.js`) uses `clerkMiddleware` with an explicit
  `await auth()` + manual redirect — **not** `auth.protect()` (which throws on
  Clerk dev instances). Public routes are whitelisted; everything else needs a
  session (pages -> `/sign-in`, APIs -> `401`).
- **Server** uses `auth()` (current `userId`) and `clerkClient()` (create/update/
  delete users, invitations, allowlist) via the **Backend API** (`sk_live`).
- **Browser** loads Clerk.js from the **Frontend API** `clerk.fella.cc`
  (`pk_live`) for the sign-in/up widgets and session cookie.
- **Access model:** admin = email in `ADMIN_EMAILS` **or** `publicMetadata.role
  = admin`. Sign-ups are restricted by Clerk **Allowlist** (a Pro feature on
  production instances) — invite or create users from `/admin`.
- **Production instance** on `fella.cc` (Pro plan). Auth email sends from
  `clkmail.fella.cc` with DKIM (`clk._domainkey` / `clk2._domainkey`), which is
  why production email delivers reliably (dev instances use a shared sender that
  Gmail spam-filters).

---

## Vercel & the CLI

The app is a standard Vercel deployment: **Serverless/Node.js Functions** for
`/api/*` and SSR, static assets on the CDN, env vars, custom domain, and Git-
linked auto-deploys. Plan: **Pro** (required for commercial use).

```bash
npm i -g vercel            # install CLI
vercel login               # authenticate
vercel link                # link cwd to brainsty/project-m6jfw (writes .vercel/)

# Deploy
vercel --prod --yes        # build on Vercel + promote to production
vercel                     # preview deploy

# Env vars (values are marked "sensitive" -> they pull back EMPTY; you can set, not read)
vercel env ls production
vercel env add  NAME production      # reads value from stdin
vercel env rm   NAME production -y
vercel env pull .env.local --environment=production --yes

# Domains, logs, deployments
vercel domains ls
vercel domains add www.fella.cc
vercel ls                  # list deployments
vercel logs <deployment-url>
```

**Env vars** (all set in Vercel, all "sensitive"): `DATABASE_URL` (+ Neon
aliases), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live`), `CLERK_SECRET_KEY`
(`sk_live`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional), `ADMIN_EMAILS`
(comma-sep), `SETUP_TOKEN` (gates the setup endpoints).

Because secrets are unpullable, **DB setup and Clerk config run at runtime** via
the token-gated `/api/setup` and `/api/setup-clerk` endpoints (call with
`x-setup-token: $SETUP_TOKEN`), not from a local machine.

---

## Local development

```bash
npm install
# Full auth/DB need the sensitive secrets (unpullable) — develop against a
# deployment, or supply your own Clerk dev keys + a Neon DATABASE_URL in .env.local:
npm run dev          # next dev
npm run build        # next build
npm run db:push      # drizzle-kit push (needs DATABASE_URL)
npm run db:studio    # drizzle-kit studio
```

Stack: Next.js 14.2.5 · `@clerk/nextjs` 5.7.5 · `@neondatabase/serverless` 0.10.4
· `drizzle-orm` 0.36.4 · `recharts` · `lucide-react` · Tailwind. PWA:
`public/manifest.webmanifest` + `public/sw.js`; the dashboard has a **Take
photo** button (`capture="environment"`) for phone OCR.

---

## Going to production (runbook)

1. **Domain DNS** must resolve — if the registrar delegates to dead nameservers
   (Squarespace ex-Google-Domains had this), switch to the registrar's live
   nameservers first.
2. **Vercel:** add the apex domain (A `@` -> Vercel IP) and `www`.
3. **Clerk:** create a **production instance** on the domain, add its 5 CNAMEs
   (`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`) at the
   registrar, verify. Requires **Clerk Pro** if you use Allowlist.
4. **Vercel env:** swap `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`
   to the `pk_live` / `sk_live` keys, then `vercel --prod`.
5. **Users:** production is a fresh user space (settings clone over, users don't).
   Recreate users in `/admin`; if migrating an older instance, remap `exams` /
   `user_kv` rows from the old `user_id` to the new one.

Not official billing advice.
