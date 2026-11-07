import type { Metadata } from "next";
import { Tracker } from "@/components/app/Tracker";

export const metadata: Metadata = { title: "Tracker", robots: { index: false, follow: false } };

export default function TrackerPage() {
  return <Tracker />;
}
