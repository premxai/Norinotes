import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Auth gate (Next 16 renamed middleware.ts to proxy.ts). No session cookie -> /login.
 * The cookie is only checked for presence here; the API validates it, and the (app) layout sends a
 * rejected session back to /login and an unfinished onboarding to /onboarding.
 */
// Share images have no file extension, so the matcher catches them: they must stay public, or link previews in Slack, X
// and LinkedIn get a redirect to /login instead of an image.
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/privacy", "/terms", "/opengraph-image", "/twitter-image", "/icon", "/apple-icon", "/session-expired"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // The landing page is public too; it sends signed-in visitors on to the dashboard itself.
  if (pathname === "/") return NextResponse.next();
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // everything except the API proxy, Next internals and files with an extension
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
