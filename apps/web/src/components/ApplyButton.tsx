"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, type ButtonStyle } from "./ui";

/** Creates an application for a job and jumps to its review page. */
export function ApplyButton({ jobId, size = "sm", variant = "primary", label = "Apply", existingApplicationId }: {
  jobId: string; label?: string; existingApplicationId?: string | null;
} & Pick<ButtonStyle, "size" | "variant">) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (existingApplicationId) {
      router.push(`/applications/${existingApplicationId}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const app = await api.createApplication(jobId);
      router.push(`/applications/${app.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size={size} arrow={!busy} onClick={apply} disabled={busy}>
        {busy ? "Starting..." : label}
      </Button>
      {error && <span className="max-w-xs text-[12px] text-danger-fg">{error}</span>}
    </span>
  );
}
