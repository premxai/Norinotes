import type { Metadata } from "next";
import { PreferencesStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Step 6 of 6: Preferences", robots: { index: false, follow: false } };

export default function Page() {
  return <PreferencesStep />;
}
