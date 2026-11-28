"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api } from "@/lib/api";

/**
 * "Make my resume": asks the worker to tailor the resume for this application (queue `prepare.resume`,
 * POST /applications/:id/resume) and picks it up when it is ready. For a job the person applies to themselves Nori parks
 * without tailoring, so this is the way to the PDF; on any other application it makes a fresh copy.
 */
export function MakeResume({ id, refresh, label = "Make my resume" }: { id: string; refresh: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Once asked, look for it every few seconds; the page shows it as soon as the worker has stored it.
  useEffect(() => {
    if (!asked) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [asked, refresh]);

  const ask = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api.requestResume(id);
      setAsked(true);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Couldn’t ask for the resume. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void ask()}
        disabled={busy || asked}
        aria-disabled={busy || asked || undefined}
        className={buttonClass(asked ? "outline" : "primary", "min-h-11")}
      >
        {asked ? "Making it…" : busy ? "Asking…" : label}
      </button>
      {asked && <p role="status" className="text-small text-ink-2">This page shows it as soon as it’s ready.</p>}
      {failure && <FormError>{failure}</FormError>}
    </div>
  );
}
