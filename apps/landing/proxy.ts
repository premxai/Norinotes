import { NextResponse, type NextRequest } from "next/server";

/*
 * Dashboard addresses that aren't pages (error pages spec section 2). They render the in-shell 404, but Next streams
 * the dashboard's responses, so the page's notFound() comes too late to change the status from 200. Marking them here,
 * before rendering, makes them a real 404 while the shell still shows.
 */
const YOU = new Set(["search", "nori", "account"]);

function missing(path: string) {
  const [, section, a, b] = path.split("/");
  if (section === "today") return a !== undefined;
  if (section === "you") return a !== undefined && (!YOU.has(a) || b !== undefined);
  if (section === "applications" || section === "inbox") return b !== undefined;
  return false;
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  return missing(path) ? NextResponse.rewrite(request.nextUrl, { status: 404 }) : NextResponse.next();
}

export const config = { matcher: ["/today/:path+", "/you/:path+", "/applications/:id/:path+", "/inbox/:id/:path+"] };
