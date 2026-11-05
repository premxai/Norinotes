"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// Loaded only when something breaks, as at the root (error pages spec section 9).
const ShellError = dynamic(() => import("@/components/ErrorPages").then((m) => m.ShellError), { ssr: false });

/** An error thrown in a dashboard page; the shell (its layout) stays (error pages spec section 2). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Something went wrong · Norinote";
  }, []);
  return <ShellError kind="broke" reset={reset} />;
}
