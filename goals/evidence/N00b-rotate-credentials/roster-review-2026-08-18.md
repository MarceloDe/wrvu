# Clerk roster review — 2026-08-18

Source: Clerk dashboard, app `app_3FblcezcMcPQ64uoxRSZ8kZe72Y`,
instance `ins_3G4NUyWpdRIk7p6FaI1RqQzhgkF` (Production).

Performed via the dashboard UI, not the ops CLI: `CLERK_SECRET_KEY` is tagged
**Sensitive** in Vercel and is write-only — unreadable by anyone, dashboard or CLI.

## Roster — 4 users

| Email | Last signed in | Joined | Verdict |
|---|---|---|---|
| `mocfelix@gmail.com` (Marcelo Felix) | 2026-08-16 | 2026-07-05 | owner |
| `gsaigal@med.miami.edu` | 2026-08-14 | 2026-07-05 | expected |
| `nnagornaya@med.miami.edu` | never | 2026-07-05 | expected, never used |
| `gaurav.saigal@rocketmail.com` | never | 2026-08-14 | **queried, CONFIRMED LEGITIMATE** |

## The one that was flagged

`gaurav.saigal@rocketmail.com` was created 2026-08-14 — alone, five weeks after the
initial batch, on a personal (non-institutional) domain, and has never signed in. That
is the exact shape a backdoor account minted through the `SETUP_TOKEN` exposure would
take, and the exposure was live at the time.

Confirmed by the owner on 2026-08-18: it is Gaurav Saigal's personal email, the same
person as `gsaigal@med.miami.edu`. Not an incident.

## Conclusion

**No unexplained accounts.** No evidence the `SETUP_TOKEN` exposure was ever exploited.
Session revocation is therefore not required as incident response; it remains optional
hardening alongside `N00e`.

Note: "Total sign-ups: 0 (all time)" in Clerk analytics is consistent — every account was
created through the Backend API, never the sign-up flow.
