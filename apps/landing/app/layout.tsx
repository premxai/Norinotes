import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistSerifTriangle } from "geist/font/serif/triangle";
import { NoriStage } from "@/components/NoriStage";
import { Settle } from "@/components/Settle";
import { GeistMono } from "./fonts";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3400";
const TITLE = "Norinote: a few jobs you're likely to get, every morning";
const DESCRIPTION = "Nori finds jobs you're likely to get, tailors your resume and applies when you say so, in about 20 seconds each.";

const THEME_SCRIPT = `try{var t=localStorage.getItem("norinote-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-app-theme",t)}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s · Norinote" },
  description: DESCRIPTION,
  applicationName: "Norinote",
  // The same file the nav's logo uses, so the browser fetches it once (app/icon.png would add a second, hashed URL).
  icons: { icon: { url: "/icon-32.png", sizes: "32x32", type: "image/png" } },
  openGraph: { type: "website", siteName: "Norinote", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf4ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script below may set data-app-theme before React hydrates.
    <html lang="en-US" className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerifTriangle.variable}`} suppressHydrationWarning>
      <head>
        {/* The dashboard's saved theme, applied before the first paint so dark never flashes light (4a spec section 5). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        {/* One Nori for the whole app, so it carries over from the landing page into sign-up and onboarding. */}
        <NoriStage />
        <Settle />
      </body>
    </html>
  );
}
