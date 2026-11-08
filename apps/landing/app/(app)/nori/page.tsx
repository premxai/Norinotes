import type { Metadata } from "next";
import { NoriV2 } from "@/components/app/NoriV2";

export const metadata: Metadata = { title: "Nori", robots: { index: false, follow: false } };

export default function NoriRoute() {
  return <NoriV2 />;
}
