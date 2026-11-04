import type { Metadata } from "next";
import { AppPlaceholder } from "@/components/app/AppPlaceholder";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

export default function Page() {
  return <AppPlaceholder title="Applications" part="Part 4b" body="Every application, its receipt and its run log land here next. Until then, Today shows each one as it goes." />;
}
