import type { MetadataRoute } from "next";

const SITE = (process.env.WEB_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/signup", "/login", "/privacy", "/terms"].map((p) => ({ url: `${SITE}${p}`, changeFrequency: p === "/" ? "weekly" : "monthly", priority: p === "/" ? 1 : 0.5 }));
}
