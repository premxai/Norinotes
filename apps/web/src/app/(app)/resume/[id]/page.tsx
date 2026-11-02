import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ApiError, api, resumePdfUrl, USE_MOCK } from "@/lib/api";
import { ResumePreview } from "@/components/ResumePreview";
import { ChangeCard } from "@/components/review/ChangeCard";
import { Accordion, Frame, Icon, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Resume" };

/** A tailored resume, read-only: the one-page PDF, each changed line with its source, and the applicant-system checks. */
export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [resume, graph] = await Promise.all([
    api.getResume(id).catch((e: unknown) => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); throw e; }),
    api.graph().catch(() => ({ nodes: [], edges: [] })),
  ]);
  const nodes = Object.fromEntries(graph.nodes.map((n) => [n.id, { label: n.label, type: n.type, quote: n.sourceQuote ?? null }]));
  return (
    <div className="flex flex-col gap-5">
      {resume.applicationId && (
        <Link href={`/applications/${resume.applicationId}`} className="inline-flex w-fit items-center gap-1.5 text-meta text-muted hover:text-ink">
          <Icon icon={ArrowLeft} size={14} /> Application
        </Link>
      )}
      <PageHeader
        title={resume.content.name ? `Resume: ${resume.content.name}` : "Resume"}
        subtitle={`${resume.pages ?? "?"} page${resume.pages === 1 ? "" : "s"}. Every changed line traces to a fact in your career graph.`}
        actions={!USE_MOCK && (
          <a href={resumePdfUrl(resume.id)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-control border border-control px-4 text-[13px] font-semibold text-ink hover:bg-sunken">
            Open PDF <Icon icon={ArrowUpRight} size={14} />
          </a>
        )}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {resume.changes.length > 0 ? (
            <>
              <h2 className="text-title font-semibold text-ink">{resume.changes.length} change{resume.changes.length === 1 ? "" : "s"}</h2>
              <ul className="flex flex-col gap-2.5">
                {resume.changes.map((c) => <ChangeCard key={c.bulletId} change={c} nodes={nodes} />)}
              </ul>
            </>
          ) : (
            <p className="rounded-card bg-sunken px-4 py-3 text-body-sm text-ink-2">Nothing needed changing: your base resume already fits this posting.</p>
          )}
          {resume.atsChecks.length > 0 && (
            <Accordion title="Applicant system checks" meta={`${resume.atsChecks.filter((c) => c.pass).length} of ${resume.atsChecks.length} pass`}>
              <ul className="flex flex-col gap-1.5">
                {resume.atsChecks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-meta">
                    <span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", c.pass ? "bg-accent" : "bg-danger")} aria-hidden="true" />
                    <span className={c.pass ? "text-ink-2" : "text-ink"}>{c.label}{c.detail ? <span className="text-muted"> · {c.detail}</span> : null}</span>
                    <span className="sr-only">{c.pass ? "passes" : "fails"}</span>
                  </li>
                ))}
              </ul>
            </Accordion>
          )}
        </div>
        <Frame className="self-start overflow-hidden p-1.5">
          <ResumePreview resume={resume} className="h-[560px] rounded-[8px] xl:h-[760px]" />
        </Frame>
      </div>
    </div>
  );
}
