import type { Metadata } from "next";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { LanesFrame } from "@/components/agent/Lanes";
import { Channels, DangerZone, SettingsForm } from "@/components/SettingsForm";
import { LogoutButton } from "@/components/LogoutButton";
import { SecurityPanel } from "@/components/SecurityPanel";
import { Frame, Notice, PageHeader, TextLink } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "lanes", label: "Lanes and limits" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Account and security" },
] as const;

function Section({ id, title, line, children }: { id: string; title: string; line?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="text-title font-semibold text-ink">{title}</h2>
      {line && <p className="mt-0.5 max-w-prose text-meta text-muted">{line}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const [me, lanes, telegram] = await Promise.all([
    api.me().catch(() => null), api.lanes().catch(() => null), api.telegramInfo().catch(() => null),
  ]);
  if (!me) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Notice tone="red">Cannot load your settings right now. Try again in a moment.</Notice>
      </div>
    );
  }
  const { user, profile } = me;
  return (
    <div>
      <PageHeader title="Settings" subtitle="What Norinote looks for, how it reaches you, and your account." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:px-0">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex h-9 shrink-0 items-center rounded-control px-3 text-[13.5px] font-medium text-ink-2 hover:bg-sunken hover:text-ink">{s.label}</a>
          ))}
        </nav>
        <div className="flex min-w-0 max-w-3xl flex-col gap-10">
          <Section id="profile" title="Profile" line="The answers application forms ask every time.">
            <Frame className="p-4 sm:p-5">
              <dl className="text-body-sm">
                {[["Name", profile.fullName ?? user.name ?? "Not set"], ["Email", profile.email ?? user.email], ["Phone", profile.phone ?? "Not set"], ["Location", profile.location ?? "Not set"]].map(([k, v], i) => (
                  <div key={k} className={`flex justify-between gap-4 py-2 ${i > 0 ? "border-t border-line" : ""}`}>
                    <dt className="text-muted">{k}</dt>
                    <dd className="truncate text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-line pt-3"><TextLink href="/profile">Edit your profile and form answers</TextLink></div>
            </Frame>
          </Section>
          <Section id="lanes" title="Lanes and limits" line="Lanes say which jobs may reach your shortlist. The cap limits how many Norinote sends by itself each day.">
            <div className="flex flex-col gap-5">
              {lanes === null ? <Notice tone="red">Cannot load your lanes right now. Try again in a moment.</Notice> : <LanesFrame initial={lanes} />}
              <SettingsForm profile={profile} />
            </div>
          </Section>
          <Section id="notifications" title="Notifications" line="Link Telegram to hear from Norinote on your phone.">
            <Channels telegram={telegram} />
          </Section>
          <Section id="account" title="Account and security">
            <div className="flex flex-col gap-5">
              <Frame className="p-4 sm:p-5">
                <dl className="text-body-sm">
                  {[["Name", user.name ?? profile.fullName ?? "Not set"], ["Email", user.email]].map(([k, v], i) => (
                    <div key={k} className={`flex justify-between gap-4 py-2 ${i > 0 ? "border-t border-line" : ""}`}>
                      <dt className="text-muted">{k}</dt>
                      <dd className="truncate text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 border-t border-line pt-3"><LogoutButton /></div>
              </Frame>
              <SecurityPanel user={user} />
              <div>
                <h3 className="text-body-sm font-semibold text-danger-fg">Delete account</h3>
                <p className="mt-0.5 text-meta text-muted">Removes your account, graph, resumes and applications for good. This cannot be undone.</p>
                <div className="mt-3"><DangerZone email={user.email} /></div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
