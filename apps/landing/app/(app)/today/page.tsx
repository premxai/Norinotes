import type { Metadata } from "next";
import { Today } from "@/components/app/Today";

export const metadata: Metadata = { title: "Today", robots: { index: false, follow: false } };

export default function TodayPage() {
  return <Today />;
}
