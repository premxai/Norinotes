import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
/** apps/api, which sign-in and sign-up call from the browser (auth-design-spec.md section 9). */
const API = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;

/**
 * The site is static and only loads from its own origin (fonts, scenes and Nori's sprites are all self-hosted); the
 * auth pages also call the API. Next's bootstrap scripts are inline, hence 'unsafe-inline'; 'unsafe-eval' and
 * websockets only in dev (hot reload).
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' ${API}${dev ? " ws: wss:" : ""}`,
  // Only on an https site: on http://localhost, Safari would upgrade every asset to https and load nothing.
  ...(!dev && (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  // QA builds into its own folder so `next dev` (which uses .next) can keep running beside it.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  transpilePackages: ["@norinote/nori-pet"],
  // Sign-in and onboarding send people to /dashboard; the dashboard's first page is Today (4a spec section 1).
  async redirects() {
    return [{ source: "/dashboard", destination: "/today", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      // The email links carry a one-time token in the query string: never pass the URL on to anyone.
      ...["/reset-password", "/verify-email"].map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
