import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * The landing page is static and only loads from its own origin (fonts, scenes and Nori's sprites are all self-hosted).
 * Next's bootstrap scripts are inline, hence 'unsafe-inline'; 'unsafe-eval' and websockets only in dev (hot reload).
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
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  // Only on an https site: on http://localhost, Safari would upgrade every asset to https and load nothing.
  ...(!dev && (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  // QA builds into its own folder so `next dev` (which uses .next) can keep running beside it.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  transpilePackages: ["@norinote/nori-pet"],
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
    ];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
