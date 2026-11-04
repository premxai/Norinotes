import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inbox", robots: { index: false, follow: false } };

/** The Inbox itself is the layout; this route only names the page. */
export default function InboxPage() {
  return null;
}
