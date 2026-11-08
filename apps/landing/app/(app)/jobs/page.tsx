import type { Metadata } from "next";
import { Jobs } from "@/components/app/Jobs";

export const metadata: Metadata = { title: "Jobs", robots: { index: false, follow: false } };

export default function JobsPage() {
  return <Jobs />;
}
