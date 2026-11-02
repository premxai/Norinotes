import type { MetadataRoute } from "next";

const SITE = (process.env.WEB_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Crawlers may read the public pages only; the app itself sits behind sign-in. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/privacy", "/terms", "/login", "/signup"], disallow: ["/api/", "/dashboard", "/jobs", "/applications", "/resume", "/settings", "/onboarding", "/reset-password", "/verify-email"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
