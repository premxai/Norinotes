import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Where a rejected session goes. Server components cannot clear a cookie, and a stale session cookie kept bouncing the
 * landing page to /dashboard and back to /login. This drops the cookie and sends the person to sign in, keeping where
 * they were (same-site paths only).
 */
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("next") ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "";
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = next && next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : "";
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
