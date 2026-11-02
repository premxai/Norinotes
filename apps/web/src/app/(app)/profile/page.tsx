import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { AnswersEditor } from "@/components/AnswersEditor";
import { Card, Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Profile" };

/** The answers application forms ask most often. A missing one makes Norinote stop and ask, so they are worth filling. */
function gaps(p: Profile): string[] {
  const checks: [boolean, string][] = [
    [!!p.fullName, "Full name"],
    [!!p.email, "Email"],
    [!!p.phone, "Phone"],
    [!!(p.location || p.city), "Location"],
    [!!p.linkedin, "LinkedIn"],
    [p.workAuth.authorizedUS !== undefined, "Authorized to work in the US"],
    [p.workAuth.needsSponsorship !== undefined, "Needs sponsorship"],
    [p.salaryExpectation?.amount != null, "Salary expectation"],
    [!!p.earliestStartDate || p.noticePeriodWeeks != null, "Start date or notice period"],
    [p.over18 != null, "Over 18"],
    [!!p.securityClearance, "Security clearance"],
  ];
  return checks.filter(([ok]) => !ok).map(([, label]) => label);
}

export default async function ProfilePage() {
  const me = await api.me().catch(() => null);
  if (!me) {
    return (
      <div>
        <PageHeader title="Profile" />
        <Notice tone="red">Cannot load your profile right now. Try again in a moment.</Notice>
      </div>
    );
  }
  const missing = gaps(me.profile);
  const total = 11;
  const share = Math.round(((total - missing.length) / total) * 100);
  return (
    <div>
      <PageHeader title="Profile" subtitle="The answers forms ask every time. Norinote answers from here and never guesses; anything missing makes it stop and ask you." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <AnswersEditor profile={me.profile} />
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Card title="Ready for forms">
            <div className="flex items-baseline justify-between">
              <span className="text-display-md font-semibold text-ink tnum">{share}%</span>
              <span className="text-meta text-muted tnum">{total - missing.length} of {total} answered</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label="Profile completeness">
              <div className="h-full rounded-full bg-ink" style={{ width: `${share}%` }} />
            </div>
            {missing.length > 0 ? (
              <>
                <p className="mt-4 text-meta font-medium text-ink">Still missing</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {missing.map((m) => <li key={m} className="text-meta text-ink-2">{m}</li>)}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-meta text-muted">Everything forms usually ask is answered.</p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
