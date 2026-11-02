"use client";

import Link from "next/link";
import { useEffect } from "react";
import { NorinoteMark } from "@/components/Logo";
import { Button, Frame, buttonClass } from "@/components/ui";

const DEV = process.env.NODE_ENV !== "production";

/** What happened, what was not affected, what to do. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[norinote] page error", error.digest ?? "", error.message); }, [error]);
  return (
    <Frame className="mx-auto mt-6 flex max-w-xl flex-col items-start gap-3 p-6 sm:mt-16 sm:p-8">
      <NorinoteMark size={44} />
      <p className="text-meta text-muted">Error</p>
      <h1 className="text-display-md font-semibold text-ink">Something broke on our side</h1>
      <p className="text-body-sm text-ink-2" role="alert">
        {DEV && error.message ? error.message : "Nothing was sent, and your data is safe. Try again in a moment."}
      </p>
      {error.digest && <p className="text-meta text-muted">If it keeps happening, quote reference {error.digest}.</p>}
      {DEV && <p className="text-meta text-muted">If the API is not running, start apps/api on port 4000 or set NEXT_PUBLIC_USE_MOCK=1 in apps/web/.env.local.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClass({ variant: "secondary" })}>Back to the start</Link>
      </div>
    </Frame>
  );
}
