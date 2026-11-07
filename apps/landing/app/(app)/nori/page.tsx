import type { Metadata } from "next";
import { NoriPage } from "@/components/app/NoriPage";

export const metadata: Metadata = { title: "Nori", robots: { index: false, follow: false } };

export default function NoriRoute() {
  return <NoriPage />;
}
