import type { Metadata } from "next";
import { AppPlaceholder } from "@/components/app/AppPlaceholder";

export const metadata: Metadata = { title: "Inbox", robots: { index: false, follow: false } };

export default function Page() {
  return <AppPlaceholder title="Inbox" part="Part 4b" body="Codes and replies from employers land here next. Nori already uses them to finish applications." />;
}
