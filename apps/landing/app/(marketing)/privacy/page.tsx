import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { readLegal } from "@/lib/legal";

// Read and checked at build time (legal pages spec section 4): the page is static.
export const dynamic = "force-static";

const doc = readLegal("privacy");

export const metadata: Metadata = {
  title: "Privacy policy",
  // The summary's first sentence.
  description: doc.summary.replace(/\*\*/g, "").split(/(?<=\.) /)[0],
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return <LegalPage doc={doc} />;
}
