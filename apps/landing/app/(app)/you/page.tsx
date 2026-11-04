import type { Metadata } from "next";
import { AppPlaceholder } from "@/components/app/AppPlaceholder";

export const metadata: Metadata = { title: "You", robots: { index: false, follow: false } };

export default function Page() {
  return <AppPlaceholder title="You" part="Part 4c" body="Your career graph, lanes, autopilot, Telegram and account settings come here next. The theme switch is in the account menu." />;
}
