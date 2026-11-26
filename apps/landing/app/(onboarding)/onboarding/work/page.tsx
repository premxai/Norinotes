import type { Metadata } from "next";
import { WorkStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Step 3 of 6: Work", robots: { index: false, follow: false } };

export default function Page() {
  return <WorkStep />;
}
