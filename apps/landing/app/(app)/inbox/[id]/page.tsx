import type { Metadata } from "next";

export const metadata: Metadata = { title: "Message · Inbox", robots: { index: false, follow: false } };

/** The open message is drawn by the Inbox layout, which reads the id. */
export default function MessagePage() {
  return null;
}
