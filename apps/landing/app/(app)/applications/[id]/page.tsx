import type { Metadata } from "next";
import { ApplicationPage } from "@/components/app/ApplicationPage";

export const metadata: Metadata = { title: "Application", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationPage key={id} id={id} />;
}
