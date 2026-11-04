import type { Metadata } from "next";
import { OnboardingRedirect } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Getting started", robots: { index: false, follow: false } };

export default function Onboarding() {
  return <OnboardingRedirect />;
}
