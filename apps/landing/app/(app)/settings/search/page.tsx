import type { Metadata } from "next";
import { JobSearch } from "@/components/app/you/JobSearch";

export const metadata: Metadata = { title: "Job search · Settings", robots: { index: false, follow: false } };

export default function Page() {
  return <JobSearch />;
}
