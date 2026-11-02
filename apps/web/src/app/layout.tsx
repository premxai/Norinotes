import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const SITE = process.env.WEB_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DESCRIPTION = "Norinote turns your resume into a career graph, shortlists jobs you are likely to get, and prepares each application so sending takes one click.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Norinote", template: "%s - Norinote" },
  description: DESCRIPTION,
  applicationName: "Norinote",
  openGraph: { type: "website", siteName: "Norinote", title: "Norinote: a daily shortlist of jobs you are likely to get", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Norinote: a daily shortlist of jobs you are likely to get", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfaf8",
};

// Every page reads live API data; never prerender at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
