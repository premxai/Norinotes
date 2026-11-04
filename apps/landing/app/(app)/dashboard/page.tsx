import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Today", robots: { index: false, follow: false } };

export default function Dashboard() {
  return <ComingNext title="Today's shortlist" part="Part 4 · Dashboard" body="The dashboard is designed and built after onboarding. You're signed in." />;
}
