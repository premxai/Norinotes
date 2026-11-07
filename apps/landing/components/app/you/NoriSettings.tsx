"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { ChoiceGroup, Label, SelectField } from "@/components/onboarding/controls";
import { api, type BankAnswer, type Profile, type TelegramEvents, type TelegramSettings, type TelegramState } from "@/lib/api";
import { checkEmail, noriReact } from "@/lib/auth-flow";
import { shortDate } from "@/lib/app-state";
import { CARD, DANGER_BUTTON, DANGER_FILL, H2, HINT, Status, TEXT_BUTTON } from "./YouTabs";

/* /you/nori: the daily limit, what Nori puts on forms, the answers it remembered, and Telegram (4c spec section 5). */

/** Tells the shell to read today's use and the limit again, so the rail's meter follows a change at once. */
export const refreshAgent = () => dispatchEvent(new Event("norinote:agent"));

type Loaded = { profile: Profile; used: number | null; answers: BankAnswer[] | string; telegram: TelegramState | string };

export function NoriSettings() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Everything at once, so no section pushes the next one down as it arrives (4c spec section 11).
  useEffect(() => {
    void Promise.all([api.me(), api.agentStatus(), api.answers(), api.telegram()]).then(([me, agent, answers, telegram]) => {
      if (!me.ok) return setError(me.error);
      setData({ profile: me.data.profile, used: agent.ok ? agent.data.usedToday : null, answers: answers.ok ? answers.data : answers.error, telegram: telegram.ok ? telegram.data : telegram.error });
    });
  }, []);
  if (error)
    return (
      <div className={CARD}>
        <p className="font-semibold text-ink">Couldn&rsquo;t load your settings.</p>
        <p className={HINT}>{error}</p>
      </div>
    );
  if (!data) return <div aria-hidden="true" className="h-[900px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />;
  return (
    <>
      <DailyLimit initial={data.profile.autoApplyDailyCap} used={data.used} />
      <FormGroups profile={data.profile} onSaved={(profile) => setData((d) => (d ? { ...d, profile } : d))} />
      <Answers initial={data.answers} />
      <Telegram initial={data.telegram} />
    </>
  );
}

// ---- the daily limit ------------------------------------------------------------------------------------------------------

function DailyLimit({ initial, used }: { initial: number; used: number | null }) {
  const [cap, setCap] = useState(initial);
  const [state, setState] = useState<"idle" | "saved" | string>("idle");
  const timer = useRef(0);
  function change(next: number) {
    setCap(next);
    setState("idle");
    clearTimeout(timer.current);
    // Saved once the clicking stops.
    timer.current = window.setTimeout(async () => {
      const r = await api.saveProfile({ autoApplyDailyCap: next });
      setState(r.ok ? "saved" : r.error);
      if (r.ok) refreshAgent();
    }, 600);
  }
  const btn = "grid size-11 place-items-center rounded-[12px] border-[1.5px] border-line-strong text-[1.25rem] font-semibold text-ink hover:bg-tint";
  return (
    <section aria-labelledby="limit-h" className={CARD}>
      <h2 id="limit-h" className={H2}>
        Daily limit
      </h2>
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="One fewer" onClick={() => change(cap <= 1 ? 0 : cap - 1)} disabled={cap === 0} className={`${btn} disabled:opacity-35`}>
            −
          </button>
          <output aria-live="polite" aria-label="Daily limit" className="min-w-[88px] text-center text-[1.5rem] font-semibold text-ink tabular-nums">
            {cap === 0 ? "No limit" : cap}
          </output>
          <button type="button" aria-label="One more" onClick={() => change(cap === 0 ? 1 : Math.min(100, cap + 1))} disabled={cap >= 100} className={`${btn} disabled:opacity-35`}>
            +
          </button>
        </div>
        <p className="text-[0.9375rem] text-ink">
          {cap > 0 && "applications a day · "}
          <b className="tabular-nums">{used === null ? "…" : `${used} sent today`}</b>
        </p>
        {state === "saved" ? <Status>Saved.</Status> : state !== "idle" && <Status tone="error">{state}</Status>}
      </div>
      <p className={`${HINT} text-[0.875rem]`}>Nori sends only what you approve, one at a time or as a batch you start on the Nori page. The count starts again at midnight UTC.</p>
    </section>
  );
}

// ---- what Nori puts on forms ----------------------------------------------------------------------------------------------

const clean = (v: string) => (v.trim() ? v.trim() : null);
const yesNo = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : null);
const YES_NO = [
  { value: "yes" as const, label: "Yes" },
  { value: "no" as const, label: "No" },
];
const DECLINE = "I don't wish to answer";
const EEO = {
  gender: [DECLINE, "Female", "Male", "Non-binary"],
  race: [DECLINE, "Hispanic or Latino", "White", "Black or African American", "Asian", "Native Hawaiian or Other Pacific Islander", "American Indian or Alaska Native", "Two or more races"],
  veteran: [DECLINE, "I am a protected veteran", "I am not a protected veteran"],
  disability: [DECLINE, "Yes, I have a disability (or had one in the past)", "No, I don't have a disability"],
} as const;

/** One disclosure with its own Save (4c spec section 5.2). */
function Group({ title, summary, open, onToggle, onSave, busy, said, children }: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onSave: () => void;
  busy: boolean;
  said: { text: string; tone: "ok" | "error" } | null;
  children: ReactNode;
}) {
  return (
    <details open={open} onToggle={(e) => e.currentTarget.open !== open && onToggle(e.currentTarget.open)} className="group rounded-card border-[1.5px] border-line bg-surface">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 font-semibold text-ink tablet:px-5 [&::-webkit-details-marker]:hidden">
        {title}
        <span className="ml-auto flex min-w-0 items-center gap-3">
          <span className="truncate text-right text-small font-normal text-ink-2 group-open:hidden">{summary}</span>
          <span aria-hidden="true" className="flex-none text-[1.25rem] text-ink-2">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 tablet:px-5 tablet:pb-5">
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onSave} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
            {busy ? "Saving…" : "Save"}
          </button>
          {said && <Status tone={said.tone}>{said.text}</Status>}
        </div>
      </div>
    </details>
  );
}

function FormGroups({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ contact: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, { text: string; tone: "ok" | "error" } | null>>({});
  const [c, setC] = useState({
    fullName: profile.fullName ?? "", email: profile.email ?? "", phone: profile.phone ?? "", city: profile.city ?? "", state: profile.state ?? "",
    country: profile.country ?? "", linkedin: profile.linkedin ?? "", website: profile.website ?? "", github: profile.github ?? "",
  });
  const [cErr, setCErr] = useState<{ fullName?: string | null; email?: string | null }>({});
  const [w, setW] = useState({
    authorized: yesNo(profile.workAuth.authorizedUS), sponsorship: yesNo(profile.workAuth.needsSponsorship), status: profile.workAuth.status ?? "citizen",
    visaType: profile.workAuth.visaType ?? "", relocate: yesNo(profile.willingToRelocate),
  });
  const [s, setS] = useState({
    salary: profile.salaryExpectation ? profile.salaryExpectation.amount.toLocaleString("en-US") : "", period: profile.salaryExpectation?.period ?? "year",
    start: profile.earliestStartDate ?? "", notice: profile.noticePeriodWeeks != null ? String(profile.noticePeriodWeeks) : "",
    clearance: profile.securityClearance ?? "None", over18: yesNo(profile.over18),
    eeo: { gender: profile.eeo.gender ?? DECLINE, race: profile.eeo.race ?? DECLINE, veteran: profile.eeo.veteran ?? DECLINE, disability: profile.eeo.disability ?? DECLINE },
  });

  async function save(group: string, patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(group);
    setSaid((x) => ({ ...x, [group]: null }));
    const r = await api.saveProfile(patch);
    setBusy(null);
    if (!r.ok) return setSaid((x) => ({ ...x, [group]: { text: r.error, tone: "error" } }));
    onSaved(r.data);
    setSaid((x) => ({ ...x, [group]: { text: "Saved.", tone: "ok" } }));
  }
  const edited = (group: string) => setSaid((x) => ({ ...x, [group]: null }));
  const toggle = (group: string) => (o: boolean) => setOpen((x) => ({ ...x, [group]: o }));

  const salaryText = profile.salaryExpectation ? `$${profile.salaryExpectation.amount.toLocaleString("en-US")} a ${profile.salaryExpectation.period ?? "year"}` : null;
  const startText = profile.earliestStartDate ? new Date(`${profile.earliestStartDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const wa = profile.workAuth;
  const workText = [wa.authorizedUS === true ? "Allowed to work in the US" : wa.authorizedUS === false ? "Not allowed to work in the US" : null, wa.needsSponsorship === true ? "needs sponsorship" : wa.needsSponsorship === false ? "no sponsorship" : null].filter(Boolean).join(" · ");
  const cField = (k: keyof typeof c, label: ReactNode, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field
      id={`form-${k}`}
      label={label}
      value={c[k]}
      error={k === "fullName" || k === "email" ? cErr[k] : undefined}
      onChange={(e) => (setC((x) => ({ ...x, [k]: e.target.value })), setCErr((x) => ({ ...x, [k]: null })), edited("contact"))}
      {...extra}
    />
  );

  return (
    <section aria-labelledby="forms-h" className="flex flex-col gap-2.5">
      <div>
        <h2 id="forms-h" className={H2}>
          What Nori puts on forms
        </h2>
        <p className={`${HINT} mt-1`}>From onboarding. Nori fills these in on every application, and asks you when a form wants something new.</p>
      </div>

      <Group
        title="Contact"
        summary={[profile.fullName, profile.email].filter(Boolean).join(" · ")}
        open={!!open.contact}
        onToggle={toggle("contact")}
        busy={busy === "contact"}
        said={said.contact ?? null}
        onSave={() => {
          const e = { fullName: c.fullName.trim() ? null : "Enter your full name", email: checkEmail(c.email) };
          setCErr(e);
          if (e.fullName || e.email) return document.getElementById(e.fullName ? "form-fullName" : "form-email")?.focus();
          void save("contact", Object.fromEntries(Object.entries(c).map(([k, v]) => [k, clean(v)])));
        }}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 tablet:gap-x-4">
          <div className="col-span-2 tablet:col-span-1">{cField("fullName", "Full name", { autoComplete: "name" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("email", "Email on applications", { type: "email", autoComplete: "email" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("phone", <Label optional>Phone</Label>, { type: "tel", autoComplete: "tel" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("country", "Country", { autoComplete: "country-name" })}</div>
          <div>{cField("city", "City", { autoComplete: "address-level2" })}</div>
          <div>{cField("state", "State", { autoComplete: "address-level1" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("linkedin", <Label optional>LinkedIn</Label>, { type: "url" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("website", <Label optional>Website or portfolio</Label>, { type: "url" })}</div>
          <div className="col-span-2 tablet:col-span-1">{cField("github", <Label optional>GitHub</Label>, { type: "url" })}</div>
        </div>
      </Group>

      <Group
        title="Work authorisation"
        summary={workText}
        open={!!open.work}
        onToggle={toggle("work")}
        busy={busy === "work"}
        said={said.work ?? null}
        onSave={() =>
          void save("work", {
            workAuth: { authorizedUS: w.authorized ? w.authorized === "yes" : null, needsSponsorship: w.sponsorship ? w.sponsorship === "yes" : null, status: w.status, visaType: w.status === "visa" ? clean(w.visaType) : null },
            willingToRelocate: w.relocate ? w.relocate === "yes" : null,
          })
        }
      >
        <ChoiceGroup legend="Are you authorized to work in the US?" name="form-authorized" options={YES_NO} value={w.authorized} onChange={(authorized) => (setW((x) => ({ ...x, authorized })), edited("work"))} />
        <ChoiceGroup legend="Will you need visa sponsorship, now or later?" name="form-sponsorship" options={YES_NO} value={w.sponsorship} onChange={(sponsorship) => (setW((x) => ({ ...x, sponsorship })), edited("work"))} />
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <SelectField
            id="form-status"
            label="Status"
            value={w.status}
            onChange={(status) => (setW((x) => ({ ...x, status })), edited("work"))}
            options={[
              { value: "citizen", label: "US citizen" },
              { value: "permanent_resident", label: "Permanent resident" },
              { value: "visa", label: "On a visa" },
              { value: "other", label: "Other" },
            ]}
          />
          {w.status === "visa" && <Field id="form-visa" label="Visa type" value={w.visaType} placeholder="For example H-1B or F-1 OPT" onChange={(e) => (setW((x) => ({ ...x, visaType: e.target.value })), edited("work"))} />}
        </div>
        <ChoiceGroup legend={<Label optional>Open to relocating?</Label>} name="form-relocate" options={YES_NO} value={w.relocate} onChange={(relocate) => (setW((x) => ({ ...x, relocate })), edited("work"))} />
      </Group>

      <Group
        title="Standard questions"
        summary={[salaryText, startText].filter(Boolean).join(" · ")}
        open={!!open.std}
        onToggle={toggle("std")}
        busy={busy === "std"}
        said={said.std ?? null}
        onSave={() => {
          const amount = Number(s.salary.replace(/[^\d.]/g, ""));
          const weeks = Number.parseInt(s.notice, 10);
          void save("std", {
            salaryExpectation: s.salary.trim() && amount > 0 ? { amount, currency: "USD", period: s.period } : null,
            earliestStartDate: clean(s.start),
            noticePeriodWeeks: Number.isFinite(weeks) && weeks >= 0 ? Math.min(weeks, 104) : null,
            securityClearance: s.clearance,
            over18: s.over18 ? s.over18 === "yes" : null,
            eeo: s.eeo,
          });
        }}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 tablet:gap-x-4">
          <div className="col-span-2 tablet:col-span-1">
            <Field id="form-salary" label={<Label optional>Salary expectation</Label>} inputMode="numeric" placeholder="120,000" value={s.salary} onChange={(e) => (setS((x) => ({ ...x, salary: e.target.value })), edited("std"))} />
          </div>
          <div className="col-span-2 tablet:col-span-1">
            <SelectField id="form-period" label="Per" value={s.period} onChange={(period) => (setS((x) => ({ ...x, period })), edited("std"))} options={[{ value: "year", label: "A year" }, { value: "month", label: "A month" }, { value: "hour", label: "An hour" }]} />
          </div>
          <div>
            <Field id="form-start" label={<Label optional>Earliest start</Label>} type="date" value={s.start} onChange={(e) => (setS((x) => ({ ...x, start: e.target.value })), edited("std"))} />
          </div>
          <div>
            <Field id="form-notice" label={<Label optional>Notice (weeks)</Label>} inputMode="numeric" value={s.notice} onChange={(e) => (setS((x) => ({ ...x, notice: e.target.value })), edited("std"))} />
          </div>
          <div className="col-span-2 tablet:col-span-1">
            <SelectField id="form-clearance" label="Security clearance" value={s.clearance} onChange={(clearance) => (setS((x) => ({ ...x, clearance })), edited("std"))} options={["None", "Public trust", "Secret", "Top secret"].map((o) => ({ value: o, label: o }))} />
          </div>
        </div>
        <ChoiceGroup legend="Are you 18 or older?" name="form-18" options={YES_NO} value={s.over18} onChange={(over18) => (setS((x) => ({ ...x, over18 })), edited("std"))} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-ui font-semibold text-ink">
            <Label optional>Voluntary self-identification</Label>
          </legend>
          <p className={HINT}>US employers may ask these. Answering never affects whether Nori applies, and Nori only uses them where an application asks.</p>
          <div className="grid grid-cols-1 gap-3.5 tablet:grid-cols-2 tablet:gap-4">
            {(Object.keys(EEO) as (keyof typeof EEO)[]).map((k) => (
              <SelectField
                key={k}
                id={`form-${k}`}
                label={{ gender: "Gender", race: "Race or ethnicity", veteran: "Veteran status", disability: "Disability" }[k]}
                value={s.eeo[k]}
                onChange={(v) => (setS((x) => ({ ...x, eeo: { ...x.eeo, [k]: v } })), edited("std"))}
                options={EEO[k].map((o) => ({ value: o, label: o }))}
              />
            ))}
          </div>
        </fieldset>
      </Group>
    </section>
  );
}

// ---- the answers Nori remembered ------------------------------------------------------------------------------------------

const SOURCE: Record<BankAnswer["source"], string> = { user: "You told Nori", default: "Your default", model: "Nori’s draft" };
const FIRST = 50;

function Answers({ initial }: { initial: BankAnswer[] | string }) {
  const [rows, setRows] = useState<BankAnswer[] | null>(typeof initial === "string" ? null : initial);
  const error = typeof initial === "string" ? initial : null;
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (editing) document.getElementById(`answer-${editing}`)?.focus();
    else if (confirming) document.getElementById(`keep-${confirming}`)?.focus();
  }, [editing, confirming]);

  async function save(id: string) {
    const v = draft.trim();
    if (!v || v.length > 2000) return setRowError("Write an answer, or delete this one.");
    setBusy(true);
    const r = await api.editAnswer(id, v);
    setBusy(false);
    if (!r.ok) return setRowError(r.error);
    setRows((rs) => rs?.map((x) => (x.id === id ? r.data : x)) ?? null);
    setEditing(null);
    setMsg("Saved. It’s yours now, so Nori won’t change it.");
  }
  async function remove(id: string) {
    setBusy(true);
    const r = await api.removeAnswer(id);
    setBusy(false);
    if (!r.ok) return setRowError(r.error);
    setRows((rs) => rs?.filter((x) => x.id !== id) ?? null);
    setConfirming(null);
    setMsg("Deleted. Nori will ask again next time.");
  }

  const shown = rows ? (all ? rows : rows.slice(0, FIRST)) : [];
  return (
    <section aria-labelledby="answers-h" className="flex flex-col gap-2.5">
      <div>
        <h2 id="answers-h" className={H2}>
          Answers Nori remembered
        </h2>
        <p className={`${HINT} mt-1`}>What you told Nori on past applications. Nori reuses these when a form asks the same thing.</p>
      </div>
      {msg && <Status>{msg}</Status>}
      {error && !rows ? (
        <p className={HINT}>{error}</p>
      ) : !rows ? (
        <div aria-hidden="true" className="h-[120px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
      ) : rows.length === 0 ? (
        <p className="text-[0.9375rem] text-ink-2">Nothing yet. When a form asks something new, your answer is kept here for next time.</p>
      ) : (
        <>
          <ul className="overflow-hidden rounded-card border-[1.5px] border-line bg-surface">
            {shown.map((a) => (
              <li key={a.id} className="flex flex-col gap-1.5 border-b-[1.5px] border-line px-4 py-3.5 last:border-b-0 tablet:px-5">
                <p className="leading-[1.4] font-semibold text-ink">{a.questionText}</p>
                {editing === a.id ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`answer-${a.id}`} className="sr-only">
                      Your answer
                    </label>
                    <textarea
                      id={`answer-${a.id}`}
                      rows={3}
                      maxLength={2000}
                      value={draft}
                      aria-describedby={`answer-${a.id}-note`}
                      onChange={(e) => (setDraft(e.target.value), setRowError(null))}
                      className="w-full rounded-input border-[1.5px] border-line-strong bg-surface px-3.5 py-2.5 text-body leading-[1.45] text-ink"
                    />
                    {rowError && <Status tone="error">{rowError}</Status>}
                    <p id={`answer-${a.id}-note`} className={HINT}>
                      Only the answer changes; the question stays as the form asked it.
                    </p>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => void save(a.id)} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={TEXT_BUTTON}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : confirming === a.id ? (
                  <div role="alertdialog" aria-labelledby={`del-${a.id}`} className="flex flex-wrap items-center gap-2.5 rounded-[12px] bg-tint p-3">
                    <p id={`del-${a.id}`} className="flex-[1_1_220px] font-semibold text-ink">
                      Delete this answer? Nori will ask again next time.
                    </p>
                    <button type="button" onClick={() => void remove(a.id)} aria-disabled={busy || undefined} className={DANGER_FILL}>
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                    <button id={`keep-${a.id}`} type="button" onClick={() => setConfirming(null)} className={TEXT_BUTTON}>
                      Keep it
                    </button>
                    {rowError && <Status tone="error">{rowError}</Status>}
                  </div>
                ) : (
                  <>
                    <p className="leading-[1.5] whitespace-pre-line text-ink">{a.answer}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className={HINT}>
                        {SOURCE[a.source]} · {a.lastUsedAt ? `Last used ${shortDate(a.lastUsedAt)}` : "Not used yet"}
                      </span>
                      <span className="ml-auto flex gap-4">
                        <button type="button" onClick={() => (setEditing(a.id), setConfirming(null), setDraft(a.answer), setRowError(null), setMsg(null))} className={TEXT_BUTTON} aria-label={`Edit the answer to: ${a.questionText}`}>
                          Edit
                        </button>
                        <button type="button" onClick={() => (setConfirming(a.id), setEditing(null), setRowError(null), setMsg(null))} className={DANGER_BUTTON} aria-label={`Delete the answer to: ${a.questionText}`}>
                          Delete
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!all && rows.length > FIRST && (
            <button type="button" onClick={() => setAll(true)} className={buttonClass("outline", "min-h-11 self-start")}>
              Show all {rows.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---- Telegram ---------------------------------------------------------------------------------------------------------------

const EVENTS: [keyof TelegramEvents, string][] = [
  ["digest", "Morning list"],
  ["questions", "Questions from Nori"],
  ["submitted", "Sent applications"],
  ["needsUser", "When Nori needs you"],
  ["inbox", "New mail in Nori’s inbox"],
  ["summary", "Evening summary"],
];
const WAIT_MS = 15 * 60_000;
const zones = () => {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
};

function Telegram({ initial }: { initial: TelegramState | string }) {
  const [state, setState] = useState<TelegramState | null>(typeof initial === "string" ? null : initial);
  const error = typeof initial === "string" ? initial : null;
  const [link, setLink] = useState<{ url: string; until: number } | null>(null);
  const [expired, setExpired] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [v, setV] = useState<TelegramSettings | null>(typeof initial === "string" ? null : initial.settings);
  const [busy, setBusy] = useState(false);

  // Waiting for the person to press Start: every 3 s while the page is visible, for the link's 15 minutes.
  useEffect(() => {
    if (!link) return;
    const t = window.setInterval(async () => {
      if (Date.now() > link.until) {
        setLink(null);
        setExpired(true);
        return;
      }
      if (document.hidden) return;
      const r = await api.telegram();
      if (r.ok && r.data.linked) {
        setLink(null);
        setState(r.data);
        setV(r.data.settings);
        void noriReact({ event: "hello", say: "Connected! See you in Telegram." });
      }
    }, 3000);
    return () => clearInterval(t);
  }, [link]);

  async function connect() {
    setMsg(null);
    setExpired(false);
    const r = await api.linkTelegram(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!r.ok) return setMsg({ text: r.error, tone: "error" });
    setLink({ url: r.data.link, until: Date.now() + WAIT_MS });
    window.open(r.data.link, "_blank", "noopener");
  }
  async function save() {
    if (!v || busy) return;
    setBusy(true);
    const r = await api.saveTelegram(v);
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error, tone: "error" });
    setState(r.data);
    setMsg({ text: "Saved.", tone: "ok" });
  }
  async function disconnect() {
    const r = await api.unlinkTelegram();
    if (!r.ok) return setMsg({ text: r.error, tone: "error" });
    setState((s) => (s ? { ...s, linked: false, linkedAt: null } : s));
    setMsg({ text: "Disconnected. Nori won’t message you in Telegram.", tone: "ok" });
  }
  const set = (p: Partial<TelegramSettings>) => (setV((x) => (x ? { ...x, ...p } : x)), setMsg(null));
  const time = "h-12 w-[156px] rounded-input border-[1.5px] border-line-strong bg-surface px-3 text-body text-ink";

  return (
    <section aria-labelledby="tg-h" className={CARD}>
      <h2 id="tg-h" className={H2}>
        Telegram
      </h2>
      {error && !state ? (
        <p className={HINT}>{error}</p>
      ) : !state ? (
        <div aria-hidden="true" className="h-11" />
      ) : !state.configured ? (
        <p className="text-[0.9375rem] text-ink-2">Telegram isn&rsquo;t switched on yet.</p>
      ) : !state.linked ? (
        link ? (
          <>
            <p role="status" className="font-semibold text-ink">
              Waiting for you in Telegram…
            </p>
            <p className={`${HINT} text-[0.875rem]`}>Open the bot and press Start. The link works for 15 minutes.</p>
            <div className="flex flex-wrap items-center gap-4">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={TEXT_BUTTON + " inline-flex items-center"}>
                Open Telegram again
              </a>
              <button type="button" onClick={() => setLink(null)} className={TEXT_BUTTON}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="leading-[1.5] text-ink">Get the morning list, Nori&rsquo;s questions and what was sent in Telegram, and answer from there.</p>
            {expired && <Status tone="error">The link ran out. Connect again for a new one.</Status>}
            <button type="button" onClick={() => void connect()} className={buttonClass("primary", "min-h-11 self-start")}>
              Connect Telegram
            </button>
          </>
        )
      ) : (
        v && (
          <>
            <p className="text-ink">
              <b>Connected{state.linkedAt ? ` ${shortDate(state.linkedAt)}` : ""}</b>
              {state.botUsername && <span className="text-ink-2"> · @{state.botUsername}</span>}
            </p>
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="tg-morning" className="text-ui font-semibold text-ink">
                  Morning list at
                </label>
                <div className="flex flex-wrap items-center gap-2 text-ink">
                  <input id="tg-morning" type="time" value={v.dailyTime} onChange={(e) => set({ dailyTime: e.target.value })} className={time} />
                  with
                  <select aria-label="How many jobs" value={v.count} onChange={(e) => set({ count: Number(e.target.value) })} className="h-12 rounded-input border-[1.5px] border-line-strong bg-surface px-3 text-body text-ink">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  jobs
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="tg-evening" className="text-ui font-semibold text-ink">
                  Evening summary at
                </label>
                <input id="tg-evening" type="time" value={v.summaryTime} onChange={(e) => set({ summaryTime: e.target.value })} className={time} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2.5 text-ui font-semibold text-ink">
                  <input type="checkbox" checked={v.quietHours.enabled} onChange={(e) => set({ quietHours: { ...v.quietHours, enabled: e.target.checked } })} className="size-5 accent-accent" />
                  Quiet hours
                </label>
                <div className={`flex flex-wrap items-center gap-2 text-ink ${v.quietHours.enabled ? "" : "opacity-45"}`}>
                  <input type="time" aria-label="Quiet from" disabled={!v.quietHours.enabled} value={v.quietHours.start} onChange={(e) => set({ quietHours: { ...v.quietHours, start: e.target.value } })} className={time} />
                  to
                  <input type="time" aria-label="Quiet until" disabled={!v.quietHours.enabled} value={v.quietHours.end} onChange={(e) => set({ quietHours: { ...v.quietHours, end: e.target.value } })} className={time} />
                </div>
              </div>
              <SelectField id="tg-zone" label="Time zone" value={v.timezone} onChange={(timezone) => set({ timezone })} options={[...new Set([v.timezone, ...zones()])].map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1.5 text-ui font-semibold text-ink">Messages to get</legend>
              <div className="grid grid-cols-1 gap-x-4 tablet:grid-cols-2">
                {EVENTS.map(([k, label]) => (
                  <label key={k} className="flex min-h-11 items-center gap-2.5 text-[0.9375rem] text-ink">
                    <input type="checkbox" checked={v.events[k]} onChange={(e) => set({ events: { ...v.events, [k]: e.target.checked } })} className="size-5 accent-accent" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => void save()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => void disconnect()} className={DANGER_BUTTON}>
                Disconnect
              </button>
            </div>
          </>
        )
      )}
      {msg && <Status tone={msg.tone}>{msg.text}</Status>}
    </section>
  );
}
