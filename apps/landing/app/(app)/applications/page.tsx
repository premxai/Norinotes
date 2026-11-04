import type { Metadata } from "next";
import { Applications } from "@/components/app/Applications";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

export default function ApplicationsPage() {
  return <Applications />;
}
