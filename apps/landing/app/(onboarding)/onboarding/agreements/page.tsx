import type { Metadata } from "next";
import { AgreementsStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Step 5 of 6: Agreements", robots: { index: false, follow: false } };

export default function Page() {
  return <AgreementsStep />;
}
