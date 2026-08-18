// Clerk auth gate. Everything is protected EXCEPT the public marketing landing
// page, the sign-in/sign-up flows, and the unauthenticated health check.
//
// There are no token-gated public endpoints. Operator actions against Clerk run
// locally through scripts/ops/clerk-admin.mjs, never through a deployed route.
//
// We do an explicit auth() check + manual redirect instead of auth.protect(),
// because auth.protect()'s built-in redirect can't resolve a sign-in URL on a
// Clerk development instance and throws (MIDDLEWARE_INVOCATION_FAILED). This is
// deterministic: signed-out users go to /sign-in; signed-out API calls get 401.

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/", // landing page
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId } = await auth();
  if (!userId) {
    if (req.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files (those with a dot).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
