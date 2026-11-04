import type { Metadata } from "next";
import { NoriSettings } from "@/components/app/you/NoriSettings";

export const metadata: Metadata = { title: "Nori · You", robots: { index: false, follow: false } };

export default function Page() {
  return <NoriSettings />;
}
