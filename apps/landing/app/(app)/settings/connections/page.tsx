import type { Metadata } from "next";
import { Connections } from "@/components/app/settings/Connections";

export const metadata: Metadata = { title: "Connections · Settings", robots: { index: false, follow: false } };

export default function Page() {
  return <Connections />;
}
