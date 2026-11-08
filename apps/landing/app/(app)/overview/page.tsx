import type { Metadata } from "next";
import { Overview } from "@/components/app/Overview";

export const metadata: Metadata = { title: "Overview", robots: { index: false, follow: false } };

/** Overview (dashboard v2 plan, section 1): the greeting, four Recommended jobs and the applications graph. */
export default function OverviewPage() {
  return <Overview />;
}
