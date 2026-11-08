import type { Metadata } from "next";
import { Applications } from "@/components/app/Applications";

export const metadata: Metadata = { title: "Application", robots: { index: false, follow: false } };

/** One application open beside the list (dashboard v2): the same page as /applications, with this one chosen. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Applications initialId={id} />;
}
