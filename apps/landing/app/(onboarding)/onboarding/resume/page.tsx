import type { Metadata } from "next";
import { ResumeStep } from "@/components/onboarding/ResumeStep";

export const metadata: Metadata = { title: "Step 1 of 5: Resume", robots: { index: false, follow: false } };

export default function Page() {
  return <ResumeStep />;
}
