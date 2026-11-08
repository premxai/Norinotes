import type { Metadata } from "next";
import { NoriSettings } from "@/components/app/you/NoriSettings";

export const metadata: Metadata = { title: "Profile · Settings", robots: { index: false, follow: false } };

/** Contact details, work authorization, the standard questions and the answers from past forms. */
export default function Page() {
  return <NoriSettings />;
}
