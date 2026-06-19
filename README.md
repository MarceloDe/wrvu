# NeuroRVU — Vercel deployment

A Next.js (App Router) version of the NeuroRVU artifact with a real database
(Vercel KV) and a secure server-side Anthropic proxy. The AI features —
screenshot → study extraction (vision) and live RVU lookup (web search) — are
preserved; the API key now lives server-side instead of in the browser.

## Architecture

```
Browser (Next.js client, components/NeuroRVU.jsx)
   │
   ├─ POST /api/claude  ──►  Anthropic Messages API   (key = ANTHROPIC_API_KEY, server-only)
   │                         vision + web_search tool pass straight through
   │
   └─ GET/POST/DELETE /api/store  ──►  Upstash Redis (Vercel Marketplace)
                                       keys: neurorvu:me:nrv_log | nrv_baseline | nrv_settings
```

The client never sees the Anthropic key, and your data persists in KV — so it
loads the same on desktop, web, and phone (same deployment, same account).

## Deploy — two paths

### A. Git-linked (recommended "linked application" — auto-deploys on push)

1. Create a new GitHub repo and push this folder:
   ```bash
   git init && git add . && git commit -m "NeuroRVU"
   git branch -M main
   git remote add origin git@github.com:<you>/neurorvu.git
   git push -u origin main
   ```
2. In the Vercel dashboard → **Add New → Project** → import the repo.
   Framework preset auto-detects **Next.js**. Click Deploy.
3. **Add the database:** Project → **Storage** → **Create Database** →
   **Upstash for Redis** → **Connect to project**. This auto-injects
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Add the key:** Project → **Settings → Environment Variables** →
   add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`). Apply to
   Production, Preview, Development.
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the new env vars take effect.

Every future `git push` now auto-builds and deploys. That's the "linked app."

### B. CLI (fastest one-off)

```bash
npm i -g vercel
vercel            # links/creates the project, first deploy
# then in the dashboard: add KV store (step 3) + ANTHROPIC_API_KEY (step 4)
vercel --prod     # production deploy
```

## Local development

```bash
npm install
cp .env.example .env.local      # fill in ANTHROPIC_API_KEY
# pull the KV creds Vercel created:
vercel env pull .env.local
npm run dev                     # http://localhost:3000
```

## Notes & limits

- **Function timeout / payload:** vision + web search can be slow; `maxDuration`
  is set to 60s (Pro plan recommended). Vercel caps request bodies at ~4.5 MB,
  so very large multi-screenshot uploads can fail — downscale images client-side
  if you hit this.
- **Model id:** if `/api/claude` returns a 404 model error, the model string
  changed — set `ANTHROPIC_MODEL` to the current id from your Anthropic console.
- **Auth / multi-user:** this ships single-user (KV namespace `neurorvu:me:`).
  To make it private/multi-user, add NextAuth or Clerk and replace `USER` in
  `app/api/store/route.js` with the signed-in user id. Or just enable Vercel
  **Deployment Protection** (Settings → Deployment Protection) for a quick
  password gate.
- **Want Firestore instead of KV?** Since you already run Firebase, you can
  swap `app/api/store/route.js` to read/write a Firestore collection and drop
  `@vercel/kv` — same route contract, no client changes.

## Cost

- Vercel Hobby is free for personal projects; KV (Upstash) has a free tier.
- Anthropic API usage is billed per token to your Anthropic account — vision
  extraction and web-search lookups are the main drivers.
