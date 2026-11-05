import type { Metadata } from "next";
import { ShellNotFoundPage } from "@/components/LazyErrors";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/** A dashboard address that isn't a page: the shell stays (error pages spec section 2). */
export default function NotFound() {
  return <ShellNotFoundPage />;
}
