import type { Metadata } from "next";
import { QuestionsStep } from "@/components/onboarding/steps";

export const metadata: Metadata = { title: "Step 4 of 5: Questions", robots: { index: false, follow: false } };

export default function Page() {
  return <QuestionsStep />;
}
