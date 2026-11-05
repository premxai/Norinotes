"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// An error boundary is part of every page it covers, so the page itself (the scene frame and its scenes) loads only
// when something breaks: imported directly, it put about 20 KB on every first screen (error pages spec section 9).
const FullError = dynamic(() => import("@/components/ErrorPages").then((m) => m.FullError), { ssr: false });

/** An error thrown while showing a page outside the dashboard (error pages spec section 2). Its details stay out of the page. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Something went wrong · Norinote";
  }, []);
  return <FullError kind="broke" reset={reset} />;
}
