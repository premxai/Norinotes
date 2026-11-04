import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Getting started", robots: { index: false, follow: false } };

export default function Onboarding() {
  return <ComingNext title="Let's add your resume" part="Part 3 · Onboarding" body="Onboarding is designed and built next. Your account is ready." />;
}
