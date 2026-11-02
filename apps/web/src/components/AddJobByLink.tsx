"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Notice, inputClass } from "./ui";

/** Paste one posting link and Norinote adds the job (POST /api/jobs/url). */
export function AddJobByLink() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { job } = await api.addJobByUrl(url.trim());
      setUrl("");
      setMsg({ tone: "green", text: `Added "${job.title}" at ${job.companyName}.` });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Add a job by link" className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Have a posting Norinote has not found? Paste its link" className="flex-1">
          <input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/..." />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !url.trim()} className="sm:mb-[2px]">{busy ? "Adding..." : "Add job"}</Button>
      </form>
      {msg && <div className="mt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </section>
  );
}
