import type { NextConfig } from "next";

/** Where apps/api listens. The browser only ever talks to this app; /api is proxied so the session cookie stays same-origin. */
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy. The browser only calls this origin (the API is proxied), so connect-src is 'self'.
 * Next's bootstrap scripts are inline, hence 'unsafe-inline' for scripts; 'unsafe-eval' and websockets only in dev (HMR).
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "media-src 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Next's proxy gives up on a slow API call after 30 s and answers 500. Reading a resume can take a while, so allow two minutes.
  experimental: { proxyTimeout: 2 * 60_000 },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
