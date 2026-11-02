"use client";

import { useRef, useState } from "react";
import { ArrowRight, ClipboardPaste, FileCheck2, FileUp, RotateCcw, ThumbsUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { GraphNode, IngestResult } from "@/lib/types";
import { Icon, Notice, cx, inputClass } from "../ui";
import { ObButton, Soft } from "./controls";

const ACCEPT = [".pdf", ".docx", ".txt"];
const TYPE_RANK: Record<string, number> = { role: 0, company: 1, project: 2, metric: 3, skill: 4, education: 5, tool: 6 };

/** Up to eight facts worth showing: the ingest's own list when the API returns one, otherwise the best-connected nodes. */
async function topNodes(result: IngestResult): Promise<GraphNode[]> {
  if (result.nodes?.length) {
    return [...result.nodes].sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9)).slice(0, 8);
  }
  try {
    const g = await api.graph();
    const degree = new Map<string, number>();
    for (const e of g.edges) {
      degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
      degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    }
    return [...g.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, 8);
  } catch {
    return [];
  }
}

export function ResumeStep({ hasResume, busy, onDone, onResult }: {
  hasResume: boolean;
  busy?: boolean;
  onDone: (result: IngestResult | null) => Promise<void> | void;
  /** Lets the wizard react as soon as the resume has been read. */
  onResult?: (result: IngestResult) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [replace, setReplace] = useState(!hasResume);

  async function ingest(run: () => Promise<IngestResult>, label: string) {
    setReading(label);
    setError(null);
    try {
      const r = await run();
      setResult(r);
      onResult?.(r);
      setNodes(await topNodes(r));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setReading(null);
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError("Use a PDF, DOCX or TXT file.");
      return;
    }
    void ingest(() => api.uploadResumeFile(file), file.name);
  }

  // ---- after reading: counts and the first facts found
  if (result) {
    return (
      <div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-surface p-4">
            <dt className="text-meta text-muted">Facts about you</dt>
            <dd className="mt-1 text-display-lg font-semibold text-ink tnum">{result.nodesCreated}</dd>
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <dt className="text-meta text-muted">Links between them</dt>
            <dd className="mt-1 text-display-lg font-semibold text-ink tnum">{result.edgesCreated}</dd>
          </div>
          <div className="flex items-end rounded-card bg-sunken p-4 text-meta text-ink-2">
            {result.usedLLM ? "Read with the language model." : "Read with the built-in rules."}
          </div>
        </dl>

        {nodes.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-meta font-medium text-ink">Some of what Norinote found</p>
            <ul className="flex flex-wrap gap-2">
              {nodes.map((n) => (
                <li key={n.id} className="inline-flex items-center gap-2 rounded-full bg-sunken py-1 pl-3 pr-1.5 text-[13px] text-ink" title={n.label}>
                  <span className="max-w-[16rem] truncate">{n.label}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] capitalize text-muted">{n.type}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <ObButton variant="soft" onClick={() => { setResult(null); setNodes([]); }} disabled={busy}><Icon icon={RotateCcw} />Use another file</ObButton>
          <div className="flex-1" />
          <ObButton onClick={() => onDone(result)} disabled={busy}>
            {busy ? <span>Saving<span className="dots" /></span> : <><Icon icon={ThumbsUp} />Looks right</>}
          </ObButton>
        </div>
      </div>
    );
  }

  // ---- coming back with a resume already on file
  if (!replace) {
    return (
      <div>
        <Soft tint className="flex flex-wrap items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-control bg-surface text-ink"><Icon icon={FileCheck2} size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink">Resume on file</div>
            <div className="text-meta text-muted">Your graph is already built from it.</div>
          </div>
          <ObButton variant="soft" onClick={() => setReplace(true)}><Icon icon={FileUp} />Replace it</ObButton>
        </Soft>
        <div className="mt-8 flex justify-end border-t border-line pt-5">
          <ObButton onClick={() => onDone(null)} disabled={busy}>
            {busy ? <span>Saving<span className="dots" /></span> : <>Continue<Icon icon={ArrowRight} /></>}
          </ObButton>
        </div>
      </div>
    );
  }

  // ---- pick, drop or paste
  return (
    <div>
      {mode === "file" ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors",
            drag ? "border-accent bg-accent-tint" : "border-control bg-surface hover:bg-sunken/60",
            reading && "pointer-events-none",
          )}
        >
          <input ref={fileRef} type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <span className="flex h-12 w-12 items-center justify-center rounded-control bg-sunken text-ink"><Icon icon={FileUp} size={22} /></span>
          <span className="mt-4 text-title font-semibold text-ink" aria-live="polite">
            {reading ? <>Reading {reading}<span className="dots" /></> : drag ? "Drop it here" : "Drop your resume here"}
          </span>
          <span className="mt-1 text-meta text-muted">{reading ? "Turning it into facts. This can take a minute." : "or choose a PDF, DOCX or TXT file"}</span>
        </label>
      ) : (
        <div>
          <label htmlFor="resume-text" className="sr-only">Resume text</label>
          <textarea
            id="resume-text"
            className={cx(inputClass, "min-h-[260px] text-meta leading-relaxed")}
            placeholder="Paste the full text of your resume"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex justify-end">
            <ObButton onClick={() => ingest(() => api.uploadResume(text), "pasted text")} disabled={!!reading || text.trim().length < 40}>
              {reading ? <span>Reading<span className="dots" /></span> : <>Read resume<Icon icon={ArrowRight} /></>}
            </ObButton>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setMode(mode === "file" ? "paste" : "file")} className="inline-flex h-9 items-center gap-2 rounded-control px-3 text-[13px] font-medium text-ink-2 hover:bg-sunken hover:text-ink">
          <Icon icon={mode === "file" ? ClipboardPaste : FileUp} />
          {mode === "file" ? "Paste text instead" : "Upload a file instead"}
        </button>
        {hasResume && <button type="button" onClick={() => setReplace(false)} className="text-meta text-muted hover:text-ink">Keep the current resume</button>}
      </div>
      {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}
    </div>
  );
}
