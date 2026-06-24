// Public health check (whitelisted in middleware) — confirms the app is up and
// reports whether the DB + Anthropic env are wired, without leaking secrets.
export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    db: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    clerk: Boolean(process.env.CLERK_SECRET_KEY),
  });
}
