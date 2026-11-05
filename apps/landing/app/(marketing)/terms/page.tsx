import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { readLegal } from "@/lib/legal";

// Read and checked at build time (legal pages spec section 4): the page is static.
export const dynamic = "force-static";

const doc = readLegal("terms");

export const metadata: Metadata = {
  title: "Terms of service",
  // The summary's first sentence.
  description: doc.summary.replace(/\*\*/g, "").split(/(?<=\.) /)[0],
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return <LegalPage doc={doc} />;
}
