import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";
import { FinalCall, Hero, HowItWorks, PromiseSection } from "@/components/home/Landing";
import { SiteHeader } from "@/components/home/SiteHeader";
import { PublicFooter } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: { absolute: "Norinote: a daily shortlist of jobs you are likely to get" },
  description: "Norinote turns your resume into a career graph, shortlists jobs you are likely to get, and prepares each application so sending takes one click.",
};

export default async function LandingPage() {
  // Only a session the API still accepts goes to Today. A stale cookie must not make the landing page unreachable.
  if ((await cookies()).get(SESSION_COOKIE)?.value) {
    const signedIn = await api.session().then(() => true, () => false);
    if (signedIn) redirect("/dashboard");
  }
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-on-ink">Skip to content</a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <PromiseSection />
        <FinalCall />
      </main>
      <PublicFooter />
    </div>
  );
}
