import type { Metadata } from "next";
import { NotFoundPage } from "@/components/LazyErrors";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/** Any address the app doesn't have outside the dashboard (error pages spec section 2). Next answers it with a 404. */
export default function NotFound() {
  return <NotFoundPage />;
}
