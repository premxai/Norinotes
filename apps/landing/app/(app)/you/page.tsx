import type { Metadata } from "next";
import { Suspense } from "react";
import { CareerGraphPage } from "@/components/app/you/Graph";

export const metadata: Metadata = { title: "You", robots: { index: false, follow: false } };

export default function Page() {
  // The view (`?view=list`) is read from the address, so the page waits for it on the client.
  return (
    <Suspense>
      <CareerGraphPage />
    </Suspense>
  );
}
