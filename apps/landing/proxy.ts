import { NextResponse, type NextRequest } from "next/server";

/*
 * Dashboard addresses that aren't pages (error pages spec section 2). They render the in-shell 404, but Next streams
 * the dashboard's responses, so the page's notFound() comes too late to change the status from 200. Marking them here,
 * before rendering, makes them a real 404 while the shell still shows.
 */
const SETTINGS = new Set(["profile", "search", "connections"]);

function missing(path: string) {
  const [, section, a, b] = path.split("/");
  if (section === "overview" || section === "today" || section === "jobs" || section === "tracker" || section === "graph") return a !== undefined;
  if (section === "settings") return a !== undefined && (!SETTINGS.has(a) || b !== undefined);
  // You's pages moved to Career graph and Settings (next.config.ts redirects them first); anything else under it is gone.
  if (section === "you") return a !== undefined;
  if (section === "applications" || section === "inbox") return b !== undefined;
  return false;
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  return missing(path) ? NextResponse.rewrite(request.nextUrl, { status: 404 }) : NextResponse.next();
}

export const config = { matcher: ["/overview/:path+", "/today/:path+", "/jobs/:path+", "/tracker/:path+", "/graph/:path+", "/settings/:path+", "/you/:path+", "/applications/:id/:path+", "/inbox/:id/:path+"] };
