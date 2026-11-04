import type { Metadata } from "next";
import { ContactStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Step 2 of 5: Contact", robots: { index: false, follow: false } };

export default function Page() {
  return <ContactStep />;
}
