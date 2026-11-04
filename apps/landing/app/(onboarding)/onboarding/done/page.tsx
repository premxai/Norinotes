import type { Metadata } from "next";
import { DoneStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "You're all set", robots: { index: false, follow: false } };

export default function Page() {
  return <DoneStep />;
}
