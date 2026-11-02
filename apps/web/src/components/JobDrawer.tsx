import { ArrowRight, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus, JobDetail } from "@/lib/types";
import { Accordion } from "./Accordion";
import { ApplyButton } from "./ApplyButton";
import { cx } from "./cx";
import { DrawerKeys } from "./DrawerKeys";
import { Icon } from "./Icon";
import { MatchRing } from "./MatchRing";
import { Monogram } from "./Monogram";
import { STATUS_MARK } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { placeName, postedIso, seniorityKey, seniorityLabel, sourceLabel, workMode } from "./jobMeta";

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-body-sm font-semibold text-ink">{title}</h3>
        {aside && <span className="text-[12px] text-muted tnum">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Chip({ name, matched, required }: { name: string; matched: boolean; required?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[12px]", matched ? "bg-sunken text-ink" : "border border-dashed border-control text-muted")}>
      {name}
      {required && !matched && <span className="text-[11px] font-semibold text-ink-2">required</span>}
      <span className="sr-only">{matched ? ", in your graph" : ", missing"}</span>
    </span>
  );
}

/**
 * Job detail as a side drawer (a full-screen sheet on phones). Server-rendered; `closeHref` is the list URL
 * without ?job=. Escape closes it and focus returns to where it was.
 */
export function JobDrawer({ detail, closeHref, application }: {
  detail: JobDetail; closeHref: string; application?: { id: string; status: ApplicationStatus } | null;
}) {
  const { job, match } = detail;
  const req = job.requirements;
  const required = req?.skills.filter((s) => s.required) ?? [];
  const nice = req?.skills.filter((s) => !s.required) ?? [];
  const matchedSet = new Set(match?.explanation.matched.map((m) => m.requirement.toLowerCase()));
  const matchedUnique = [...new Map(match?.explanation.matched.map((m) => [m.requirement.toLowerCase(), m]) ?? []).values()];
  const missing = match?.explanation.missing ?? [];
  const mode = workMode(job);
  const place = placeName(job.location);
  const sen = seniorityKey(job);
  const waiting = application ? STATUS_MARK[application.status] === "accent" : false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${job.title} at ${job.companyName}`}>
      <DrawerKeys closeHref={closeHref} focusId="job-drawer-close" />
      <Link href={closeHref} aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-ink/30" scroll={false} />
      <aside className="relative flex h-full w-full max-w-[600px] flex-col overflow-y-auto border-l border-line bg-bg">
        <header className="sticky top-0 z-10 border-b border-line bg-bg px-4 pb-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Monogram name={job.companyName} size={32} />
            <span className="min-w-0 flex-1 truncate text-body-sm text-ink-2">
              {job.companyName} <span className="text-muted">· posted <TimeAgo iso={postedIso(job)} /></span>
            </span>
            <Link id="job-drawer-close" href={closeHref} scroll={false} aria-label="Close job details" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink">
              <Icon icon={X} size={18} />
            </Link>
          </div>
          <h2 className="mt-3 text-display-md font-semibold text-ink">{job.title}</h2>
          <p className="mt-1 text-meta text-muted">
            {[place ?? (mode === "Remote" ? "Anywhere" : null), mode, sen ? seniorityLabel(sen) : null, sourceLabel(job.atsType)].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {application ? (
              <Link href={`/applications/${application.id}`} className={cx("inline-flex h-10 items-center gap-2 rounded-control px-4 text-[13px] font-semibold", waiting ? "bg-attn-tint text-attn-fg ring-1 ring-inset ring-attn" : "bg-sunken text-ink")}>
                {STATUS_LABEL[application.status] ?? application.status} <Icon icon={ArrowRight} size={14} />
              </Link>
            ) : (
              <ApplyButton jobId={job.id} size="md" />
            )}
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-control border border-control px-4 text-[13px] font-semibold text-ink hover:bg-sunken">
              Open posting <Icon icon={ExternalLink} size={14} />
            </a>
          </div>
        </header>

        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
          <Block title="Match" aside={match ? `${matchedUnique.length} matched, ${new Set(missing.map((m) => m.requirement)).size} missing` : undefined}>
            {match ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <MatchRing score={match.score} size={56} />
                  <ul className="flex min-w-0 flex-col gap-1 text-body-sm text-ink-2">
                    {match.explanation.reasons.slice(0, 4).map((r, i) => <li key={r + i}>{r}</li>)}
                  </ul>
                </div>
                {matchedUnique.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-meta font-medium text-ink">Has, from your graph</p>
                    <ul className="flex flex-col divide-y divide-line">
                      {matchedUnique.map((m) => (
                        <li key={m.requirement + m.nodeId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-meta">
                          <span className="text-ink">{m.requirement}</span>
                          <Link href={`/graph?node=${encodeURIComponent(m.nodeId)}`} className="text-accent underline-offset-4 hover:underline">{m.label}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-meta font-medium text-ink">Missing</p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.length === 0 && <span className="text-meta text-muted">Nothing missing.</span>}
                    {missing.map((m) => <Chip key={m.requirement} name={m.requirement.length > 48 ? `${m.requirement.slice(0, 46)}…` : m.requirement} matched={false} required={m.required} />)}
                  </div>
                  {missing.length > 0 && (
                    <p className="mt-2 text-meta text-muted">Have one of these? <Link href="/graph" className="font-medium text-accent underline-offset-4 hover:underline">Add it as a fact</Link> and the score updates. Norinote never claims it for you.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-body-sm text-muted">Not scored yet.</p>
            )}
          </Block>

          <Block title="Requirements" aside={req ? `${required.length} required, ${nice.length} nice to have` : undefined}>
            {req ? (
              <div className="flex flex-col gap-4">
                {req.summary && <p className="text-body-sm text-ink-2">{req.summary}</p>}
                <dl className="grid grid-cols-3 gap-2">
                  {[["Level", sen ? seniorityLabel(sen) : "Not stated"], ["Years", req.yearsMin ?? "Not stated"], ["Family", req.roleFamily || "Not stated"]].map(([k, v]) => (
                    <div key={String(k)} className="rounded-control bg-sunken px-3 py-2">
                      <dt className="text-[12px] text-muted">{k}</dt>
                      <dd className="text-body-sm capitalize text-ink tnum">{v}</dd>
                    </div>
                  ))}
                </dl>
                {([["Required", required], ["Nice to have", nice]] as const).map(([label, list]) => (
                  <div key={label}>
                    <p className="mb-1.5 text-meta font-medium text-ink">{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.length === 0 && <span className="text-meta text-muted">None found in the posting.</span>}
                      {list.map((s) => <Chip key={s.name} name={s.name} matched={matchedSet.has(s.name.toLowerCase())} />)}
                    </div>
                  </div>
                ))}
                {req.disqualifiers.length > 0 && (
                  <p className="rounded-control bg-attn-tint px-3 py-2 text-meta text-attn-fg">Check before applying: {req.disqualifiers.join("; ")}</p>
                )}
              </div>
            ) : (
              <p className="text-body-sm text-muted">Requirements have not been read yet. Norinote reads them once per job; check back soon.</p>
            )}
          </Block>

          <Accordion title="Full description" meta={`${Math.max(1, Math.round(job.descriptionText.split(/\s+/).length / 230))} min read`}>
            <div className="max-w-prose whitespace-pre-wrap text-body text-ink-2">{job.descriptionText}</div>
          </Accordion>
        </div>
      </aside>
    </div>
  );
}
