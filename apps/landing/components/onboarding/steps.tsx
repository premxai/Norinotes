"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { api, type Lane, type Profile } from "@/lib/api";
import { checkEmail, noriReact } from "@/lib/auth-flow";
import { DONE_PATH, STEPS, draftOf, loadOnboarding, progressIndex, saveStep, setDraft, setNodes, useOnboarding, useStepGuard } from "@/lib/onboarding";
import { ChipsInput, ChoiceGroup, Label, SelectField, StepFooter, StepLoading, StepShell } from "./controls";

/* Steps 2 to 5, the done page and the /onboarding redirect (onboarding spec sections 8, 9 and 11). */

/** A step's values, kept as a draft for the visit so Back and forward again never lose them. */
function useDraft<T extends object>(key: string, init: () => T) {
  const [value, setValue] = useState<T>(() => draftOf<T>(key) ?? init());
  const update = (patch: Partial<T>) =>
    setValue((prev) => {
      const next = { ...prev, ...patch };
      setDraft(key, next);
      return next;
    });
  return [value, update] as const;
}

const clean = (v: string) => (v.trim() ? v.trim() : null);
const yesNo = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : null);
const YES_NO = [
  { value: "yes" as const, label: "Yes" },
  { value: "no" as const, label: "No" },
];

/** Saving a step: the busy state, the error box, Nori's gentle no, then on to the next page. */
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string } | null>(null);
  async function save(step: (typeof STEPS)[number]["api"], data: Record<string, unknown>, next: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await saveStep(step, data);
    setBusy(false);
    if (!r.ok) {
      setFailure({ text: r.error });
      void noriReact({ event: "auth-failed", say: r.status === 0 ? "I can't reach Norinote." : "That didn't save." });
      return;
    }
    after?.();
    router.push(next);
  }
  return { busy, failure, save, fail: (text: string) => setFailure({ text }) };
}

/** Focuses the first field with an error after a failed check. */
const focusFirst = (ids: (string | false)[]) => {
  const id = ids.find(Boolean);
  if (id) document.getElementById(id)?.focus();
};

// ---- 2 · Contact ------------------------------------------------------------------------------------------------------

const CONTACT_KEYS = ["fullName", "email", "phone", "city", "state", "country", "linkedin", "github", "website", "pronouns"] as const;
type Contact = Record<(typeof CONTACT_KEYS)[number], string>;
let saidFilled = false;

function ContactForm({ profile }: { profile: Profile }) {
  const s = useOnboarding();
  const patch = s.ingest?.profilePatch ?? {};
  const [cityFromResume, stateFromResume] = (patch.location ?? "").split(",").map((x) => x.trim());
  const resume: Partial<Contact> = {
    fullName: patch.fullName ?? undefined, email: patch.email ?? undefined, phone: patch.phone ?? undefined, linkedin: patch.linkedin ?? undefined,
    github: patch.github ?? undefined, website: patch.website ?? undefined, city: cityFromResume, state: stateFromResume,
  };
  const [v, update] = useDraft<Contact>("contact", () => {
    const out = {} as Contact;
    for (const k of CONTACT_KEYS) out[k] = (profile[k] as string | null) ?? resume[k] ?? "";
    if (!out.country) out.country = "United States";
    return out;
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Contact, string | null>>>({});
  const { busy, failure, save } = useSave();
  const fromResume = (k: keyof Contact) => !!resume[k] && v[k] === resume[k];

  useEffect(() => {
    if (!saidFilled && CONTACT_KEYS.some((k) => !!resume[k] && v[k] === resume[k])) {
      saidFilled = true;
      void noriReact({ say: "Filled these from your resume." });
    }
    // Once, when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = (k: keyof Contact, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}, optional = false) => (
    <Field
      id={`contact-${k}`}
      label={<Label optional={optional} fromResume={fromResume(k)}>{label}</Label>}
      value={v[k]}
      onChange={(e) => {
        update({ [k]: e.target.value } as Partial<Contact>);
        if (errors[k]) setErrors((x) => ({ ...x, [k]: null }));
      }}
      error={errors[k]}
      {...extra}
    />
  );

  function next() {
    const e = { fullName: v.fullName.trim() ? null : "Enter your full name", email: checkEmail(v.email) };
    setErrors(e);
    if (e.fullName || e.email) return focusFirst([!!e.fullName && "contact-fullName", !!e.email && "contact-email"]);
    void save("contact", Object.fromEntries(CONTACT_KEYS.map((k) => [k, clean(v[k])])), STEPS[2].path);
  }

  return (
    <StepShell index={1} title="How can employers reach you?" lead="Filled from your resume where we could. Check it's right." failure={failure} footer={<StepFooter back={STEPS[0].path} onContinue={next} busy={busy} />}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-[18px] tablet:gap-x-4">
        <div className="col-span-2">{field("fullName", "Full name", { autoComplete: "name" })}</div>
        <div className="col-span-2 tablet:col-span-1">{field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}</div>
        <div className="col-span-2 tablet:col-span-1">{field("phone", "Phone", { type: "tel", autoComplete: "tel" }, true)}</div>
        <div>{field("city", "City", { autoComplete: "address-level2" })}</div>
        <div>{field("state", "State", { autoComplete: "address-level1" })}</div>
        <div className="col-span-2">{field("country", "Country", { autoComplete: "country-name" })}</div>
        <div className="col-span-2 tablet:col-span-1">{field("linkedin", "LinkedIn", { type: "url", autoComplete: "url" }, true)}</div>
        <div className="col-span-2 tablet:col-span-1">{field("website", "Website or portfolio", { type: "url" }, true)}</div>
        <div className="col-span-2 tablet:col-span-1">{field("github", "GitHub", { type: "url" }, true)}</div>
        <div className="col-span-2 tablet:col-span-1">{field("pronouns", "Pronouns", {}, true)}</div>
      </div>
    </StepShell>
  );
}

export function ContactStep() {
  const s = useStepGuard(1);
  if (s.status !== "ready" || !s.profile)
    return (
      <StepShell index={1} title="How can employers reach you?" lead="Filled from your resume where we could. Check it's right.">
        <StepLoading />
      </StepShell>
    );
  return <ContactForm profile={s.profile} />;
}

// ---- 3 · Work ---------------------------------------------------------------------------------------------------------

type Work = { authorized: "yes" | "no" | null; sponsorship: "yes" | "no" | null; status: string; visaType: string; relocate: "yes" | "no" | null; setup: string | null };
const SETUPS = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
  { value: "any", label: "Any" },
];

function WorkForm({ profile }: { profile: Profile }) {
  const [v, update] = useDraft<Work>("work", () => ({
    authorized: yesNo(profile.workAuth.authorizedUS),
    sponsorship: yesNo(profile.workAuth.needsSponsorship),
    status: profile.workAuth.status ?? "citizen",
    visaType: profile.workAuth.visaType ?? "",
    relocate: yesNo(profile.willingToRelocate),
    setup: profile.remotePreference,
  }));
  const [errors, setErrors] = useState<{ authorized?: string | null; sponsorship?: string | null }>({});
  const { busy, failure, save } = useSave();

  function next() {
    const e = { authorized: v.authorized ? null : "Choose Yes or No", sponsorship: v.sponsorship ? null : "Choose Yes or No" };
    setErrors(e);
    if (e.authorized || e.sponsorship) return focusFirst([!!e.authorized && "work-authorized-yes", !!e.sponsorship && "work-sponsorship-yes"]);
    void save(
      "authorization",
      {
        workAuth: { authorizedUS: v.authorized === "yes", needsSponsorship: v.sponsorship === "yes", status: v.status, visaType: v.status === "visa" ? clean(v.visaType) : null },
        willingToRelocate: v.relocate ? v.relocate === "yes" : null,
        remotePreference: v.setup,
      },
      STEPS[3].path,
      () => void noriReact({ row: "nod" }),
    );
  }

  return (
    <StepShell index={2} title="Where can you work?" lead="Applications ask this every time. Answer once and Nori fills it in." failure={failure} footer={<StepFooter back={STEPS[1].path} onContinue={next} busy={busy} />}>
      <div className="flex flex-col gap-[18px]">
        <ChoiceGroup legend="Are you authorized to work in the US?" name="work-authorized" options={YES_NO} value={v.authorized} onChange={(x) => (update({ authorized: x }), setErrors((e) => ({ ...e, authorized: null })))} error={errors.authorized} />
        <ChoiceGroup legend="Will you need visa sponsorship, now or later?" name="work-sponsorship" options={YES_NO} value={v.sponsorship} onChange={(x) => (update({ sponsorship: x }), setErrors((e) => ({ ...e, sponsorship: null })))} error={errors.sponsorship} />
        <div className="grid grid-cols-1 gap-[18px] tablet:grid-cols-2 tablet:gap-4">
          <SelectField
            id="work-status"
            label="Status"
            value={v.status}
            onChange={(status) => update({ status })}
            options={[
              { value: "citizen", label: "US citizen" },
              { value: "permanent_resident", label: "Permanent resident" },
              { value: "visa", label: "On a visa" },
              { value: "other", label: "Other" },
            ]}
          />
          {v.status === "visa" && <Field id="work-visa" label="Visa type" value={v.visaType} placeholder="For example H-1B or F-1 OPT" onChange={(e) => update({ visaType: e.target.value })} />}
        </div>
        <ChoiceGroup legend={<Label optional>Open to relocating?</Label>} name="work-relocate" options={YES_NO} value={v.relocate} onChange={(relocate) => update({ relocate })} />
        <ChoiceGroup legend={<Label optional>How do you like to work?</Label>} name="work-setup" options={SETUPS} value={v.setup} onChange={(setup) => update({ setup })} />
      </div>
    </StepShell>
  );
}

export function WorkStep() {
  const s = useStepGuard(2);
  if (s.status !== "ready" || !s.profile)
    return (
      <StepShell index={2} title="Where can you work?" lead="Applications ask this every time. Answer once and Nori fills it in.">
        <StepLoading />
      </StepShell>
    );
  return <WorkForm profile={s.profile} />;
}

// ---- 4 · Questions ----------------------------------------------------------------------------------------------------

const DECLINE = "I don't wish to answer";
const EEO = {
  gender: [DECLINE, "Female", "Male", "Non-binary"],
  race: [DECLINE, "Hispanic or Latino", "White", "Black or African American", "Asian", "Native Hawaiian or Other Pacific Islander", "American Indian or Alaska Native", "Two or more races"],
  veteran: [DECLINE, "I am a protected veteran", "I am not a protected veteran"],
  disability: [DECLINE, "Yes, I have a disability (or had one in the past)", "No, I don't have a disability"],
} as const;
type Questions = {
  salary: string;
  period: string;
  start: string;
  notice: string;
  clearance: string;
  over18: "yes" | "no" | null;
  heard: string;
  eeo: Record<keyof typeof EEO, string>;
  eeoTouched: boolean;
};

function QuestionsForm({ profile }: { profile: Profile }) {
  const [v, update] = useDraft<Questions>("questions", () => ({
    salary: profile.salaryExpectation ? String(profile.salaryExpectation.amount) : "",
    period: profile.salaryExpectation?.period ?? "year",
    start: profile.earliestStartDate ?? "",
    notice: profile.noticePeriodWeeks != null ? String(profile.noticePeriodWeeks) : "",
    clearance: profile.securityClearance ?? "None",
    over18: yesNo(profile.over18),
    heard: profile.heardAbout ?? "",
    eeo: { gender: profile.eeo.gender ?? DECLINE, race: profile.eeo.race ?? DECLINE, veteran: profile.eeo.veteran ?? DECLINE, disability: profile.eeo.disability ?? DECLINE },
    eeoTouched: false,
  }));
  const [error, setError] = useState<string | null>(null);
  const { busy, failure, save } = useSave();
  const fold = useRef<HTMLDetailsElement>(null);

  function next() {
    if (!v.over18) {
      setError("Choose Yes or No");
      return focusFirst(["questions-18-yes"]);
    }
    const amount = Number(v.salary.replace(/[^\d.]/g, ""));
    const weeks = Number.parseInt(v.notice, 10);
    void save(
      "screening",
      {
        salaryExpectation: v.salary.trim() && amount > 0 ? { amount, currency: "USD", period: v.period } : null,
        earliestStartDate: clean(v.start),
        noticePeriodWeeks: Number.isFinite(weeks) && weeks >= 0 ? Math.min(weeks, 104) : null,
        securityClearance: v.clearance,
        over18: v.over18 === "yes",
        heardAbout: clean(v.heard),
        // Only sent when the fold was opened and an answer changed (spec section 8).
        ...(v.eeoTouched ? { eeo: v.eeo } : {}),
      },
      STEPS[4].path,
    );
  }

  const eeoSelect = (k: keyof typeof EEO, label: string) => (
    <SelectField id={`questions-${k}`} label={label} value={v.eeo[k]} onChange={(x) => update({ eeo: { ...v.eeo, [k]: x }, eeoTouched: true })} options={EEO[k].map((o) => ({ value: o, label: o }))} />
  );

  return (
    <StepShell index={3} title="The usual questions" lead="Reused on every application. Skip what you'd rather answer case by case." failure={failure} footer={<StepFooter back={STEPS[2].path} onContinue={next} busy={busy} />}>
      <div className="flex flex-col gap-[18px]">
        <div className="grid grid-cols-2 gap-x-3 gap-y-[18px] tablet:gap-x-4">
          <div className="col-span-2 tablet:col-span-1">
            <Field id="questions-salary" label={<Label optional>Salary expectation</Label>} inputMode="numeric" placeholder="120,000" value={v.salary} onChange={(e) => update({ salary: e.target.value })} />
          </div>
          <div className="col-span-2 tablet:col-span-1">
            <SelectField id="questions-period" label="Per" value={v.period} onChange={(period) => update({ period })} options={[{ value: "year", label: "A year" }, { value: "month", label: "A month" }, { value: "hour", label: "An hour" }]} />
          </div>
          <div>
            <Field id="questions-start" label={<Label optional>Earliest start</Label>} type="date" value={v.start} onChange={(e) => update({ start: e.target.value })} />
          </div>
          <div>
            <Field id="questions-notice" label={<Label optional>Notice (weeks)</Label>} inputMode="numeric" value={v.notice} onChange={(e) => update({ notice: e.target.value })} />
          </div>
          <div className="col-span-2 tablet:col-span-1">
            <SelectField id="questions-clearance" label="Security clearance" value={v.clearance} onChange={(clearance) => update({ clearance })} options={["None", "Public trust", "Secret", "Top secret"].map((o) => ({ value: o, label: o }))} />
          </div>
          <div className="col-span-2 tablet:col-span-1">
            <Field id="questions-heard" label={<Label optional>How you heard about a job</Label>} placeholder="Company website" value={v.heard} onChange={(e) => update({ heard: e.target.value })} />
          </div>
        </div>
        <ChoiceGroup legend="Are you 18 or older?" name="questions-18" options={YES_NO} value={v.over18} onChange={(over18) => (update({ over18 }), setError(null))} error={error} />
        <details
          ref={fold}
          onToggle={(e) => {
            const open = e.currentTarget.open;
            void noriReact(open ? { event: "password", say: "Only used where an application asks." } : { event: "password-done" });
          }}
          className="border-y-[1.5px] border-line"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            Voluntary self-identification (optional)
            <span className="text-small font-normal text-ink-2">{v.eeoTouched ? "Answered" : DECLINE}</span>
          </summary>
          <div className="flex flex-col gap-3.5 pt-1 pb-[18px]">
            <p className="text-small text-ink-2">US employers may ask these. Answering never affects whether Nori applies, and Nori only uses them where an application asks.</p>
            <div className="grid grid-cols-1 gap-3.5 tablet:grid-cols-2 tablet:gap-4">
              {eeoSelect("gender", "Gender")}
              {eeoSelect("race", "Race or ethnicity")}
              {eeoSelect("veteran", "Veteran status")}
              {eeoSelect("disability", "Disability")}
            </div>
          </div>
        </details>
      </div>
    </StepShell>
  );
}

export function QuestionsStep() {
  const s = useStepGuard(3);
  if (s.status !== "ready" || !s.profile)
    return (
      <StepShell index={3} title="The usual questions" lead="Reused on every application. Skip what you'd rather answer case by case.">
        <StepLoading />
      </StepShell>
    );
  return <QuestionsForm profile={s.profile} />;
}

// ---- 5 · Preferences --------------------------------------------------------------------------------------------------

type Prefs = { titles: string[]; locations: string[]; remote: "only" | "ok" | "no"; salaryMin: string; skip: string[] };

function PreferencesForm({ profile }: { profile: Profile }) {
  const s = useOnboarding();
  const p = profile.preferences;
  const [v, update] = useDraft<Prefs>("preferences", () => ({
    titles: p.titles ?? [],
    locations: p.locations ?? (profile.city ? [[profile.city, profile.state].filter(Boolean).join(", ")] : []),
    remote: p.remote ?? "ok",
    salaryMin: p.salaryMin ? String(p.salaryMin) : "",
    skip: p.excludeCompanies ?? [],
  }));
  const [error, setError] = useState<string | null>(null);
  const { busy, failure, save } = useSave();
  // Up to 3 role titles from the resume that aren't picked yet.
  const suggestions = [...new Set((s.nodes ?? []).filter((n) => n.type === "role").map((n) => n.props.title ?? "").filter(Boolean))]
    .filter((t) => !v.titles.some((x) => x.toLowerCase() === t.toLowerCase()))
    .slice(0, 3);

  function finish() {
    if (!v.titles.length) {
      setError("Add at least one job title");
      return focusFirst(["prefs-titles"]);
    }
    const min = Number(v.salaryMin.replace(/[^\d.]/g, ""));
    void save(
      "preferences",
      { preferences: { titles: v.titles, locations: v.locations, remote: v.remote, ...(min > 0 ? { salaryMin: min } : {}), excludeCompanies: v.skip } },
      DONE_PATH,
    );
  }

  return (
    <StepShell index={4} title="What are you looking for?" lead="Nori builds your first search from this. You can change it any time." failure={failure} footer={<StepFooter back={STEPS[3].path} onContinue={finish} label="Finish" busy={busy} />}>
      <div className="flex flex-col gap-[18px]">
        <ChipsInput
          id="prefs-titles"
          label="Job titles"
          values={v.titles}
          onChange={(titles) => (update({ titles }), setError(null))}
          placeholder="Add a title and press Enter"
          error={error}
          onFocus={() => void noriReact({ row: "search" })}
          onBlur={() => void noriReact({ event: "idle" })}
          after={
            suggestions.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 text-small text-ink-2">
                Suggested from your resume:
                {suggestions.map((t) => (
                  <button key={t} type="button" onClick={() => (update({ titles: [...v.titles, t] }), setError(null))} className="min-h-6 py-1 font-medium text-ink underline underline-offset-[3px]">
                    + {t}
                  </button>
                ))}
              </p>
            )
          }
        />
        <ChipsInput id="prefs-locations" label="Locations" values={v.locations} onChange={(locations) => update({ locations })} placeholder="Add a city or region" />
        <ChoiceGroup
          legend="Remote jobs"
          name="prefs-remote"
          options={[
            { value: "only", label: "Only remote" },
            { value: "ok", label: "Remote is fine" },
            { value: "no", label: "No remote" },
          ]}
          value={v.remote}
          onChange={(remote) => update({ remote })}
        />
        <div className="grid grid-cols-1 gap-[18px] tablet:grid-cols-2 tablet:gap-4">
          <Field id="prefs-min" label={<Label optional>Minimum salary, a year</Label>} inputMode="numeric" placeholder="100,000" value={v.salaryMin} onChange={(e) => update({ salaryMin: e.target.value })} />
          <ChipsInput id="prefs-skip" label={<Label optional>Companies to skip</Label>} values={v.skip} onChange={(skip) => update({ skip })} placeholder="Your current employer" />
        </div>
      </div>
    </StepShell>
  );
}

export function PreferencesStep() {
  const s = useStepGuard(4);
  // The role titles for suggestions come from the graph; read it if this visit hasn't.
  const needsGraph = s.status === "ready" && !s.nodes;
  useEffect(() => {
    if (needsGraph) void api.graph().then((r) => r.ok && setNodes(r.data.nodes));
  }, [needsGraph]);
  if (s.status !== "ready" || !s.profile)
    return (
      <StepShell index={4} title="What are you looking for?" lead="Nori builds your first search from this. You can change it any time.">
        <StepLoading />
      </StepShell>
    );
  return <PreferencesForm profile={s.profile} />;
}

// ---- Done -------------------------------------------------------------------------------------------------------------

const DONE_SEEN = "norinote-onboarding-done-seen";
const POLL_MS = 5000;
const POLL_FOR_MS = 60_000;

function Row({ done, title, children, live = false }: { done: boolean; title: string; children: React.ReactNode; live?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-row border-[1.5px] border-line bg-surface px-3.5 py-3">
      {done ? (
        <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true" className="flex-none text-accent">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="flex-none text-line-strong">
          <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>
      )}
      <div className="min-w-0">
        <p aria-live={live ? "polite" : undefined} className="font-semibold text-ink">
          {title}
        </p>
        <div className="text-small text-ink-2">{children}</div>
      </div>
    </li>
  );
}

export function DoneStep() {
  const s = useStepGuard(STEPS.length);
  const [lane, setLane] = useState<Lane | null>(null);
  const [inbox, setInbox] = useState<string | null>(null);
  const [jobs, setJobs] = useState<number | "waiting" | "later">("waiting");
  const ready = s.status === "ready" && s.progress === "done";

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(DONE_SEEN, "1");
    } catch {
      // Storage blocked: /onboarding shows this page again next time, which is harmless.
    }
    let live = true;
    void noriReact({ row: "celebrate" }).then(() => {
      if (live) void noriReact({ event: "searching" });
    });
    void api.lanes().then((r) => live && r.ok && setLane(r.data[0] ?? null));
    void api.inboxAddress().then((r) => live && r.ok && r.data.configured && setInbox(r.data.address));
    if (!s.nodes) void api.graph().then((r) => live && r.ok && setNodes(r.data.nodes));
    // The first shortlist: every 5 s for up to a minute.
    const started = Date.now();
    const poll = async () => {
      const r = await api.shortlist();
      if (!live) return;
      if (r.ok && r.data.length) {
        setJobs(r.data.length);
        void noriReact({ row: "celebrate" });
        return;
      }
      if (Date.now() - started >= POLL_FOR_MS) return setJobs("later");
      timer = window.setTimeout(poll, POLL_MS);
    };
    let timer = window.setTimeout(poll, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Once, when onboarding is done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const graph = s.nodes ? s.nodes : null;
  const roles = graph?.filter((n) => n.type === "role").length ?? 0;
  const skills = graph?.filter((n) => n.type === "skill").length ?? 0;
  return (
    <StepShell index={STEPS.length} title="You're all set" lead="Nori is finding your first jobs now. They'll be on your dashboard as soon as they're in.">
      {!ready ? (
        <StepLoading />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            <Row done={!!lane} title="Your first lane">
              {lane ? `${lane.titles.join(", ")}${lane.locations.length ? ` · ${lane.locations.join(", ")}` : ""}${lane.remote ? " or remote" : ""}` : "Setting it up…"}
            </Row>
            <Row done={!!graph} title="Your career graph">
              {graph ? `${roles} ${roles === 1 ? "role" : "roles"}, ${skills} ${skills === 1 ? "skill" : "skills"}` : "…"}
            </Row>
            {inbox && (
              <Row done title="Your Nori inbox">
                {inbox}: employers&rsquo; codes and replies land here, so Nori can finish applications for you.
              </Row>
            )}
            <Row done={typeof jobs === "number"} live title={typeof jobs === "number" ? `${jobs} ${jobs === 1 ? "job fits" : "jobs fit"} you already` : "Finding your first jobs…"}>
              {jobs === "later" ? "Nori is still looking. They'll be on your dashboard." : "They'll be on your dashboard as soon as they're in."}
            </Row>
          </ul>
          <Link href="/dashboard" className={buttonClass("primary", "min-h-12 self-start max-tablet:w-full")}>
            Open my dashboard
          </Link>
        </>
      )}
    </StepShell>
  );
}

// ---- /onboarding ------------------------------------------------------------------------------------------------------

/** /onboarding: opens the step to resume at, the done page once, then the dashboard (spec section 9). */
export function OnboardingRedirect() {
  const s = useOnboarding();
  const router = useRouter();
  useEffect(() => {
    void loadOnboarding();
  }, []);
  useEffect(() => {
    if (s.status === "signed-out") return router.replace("/signin?next=/onboarding");
    if (s.status !== "ready") return;
    const at = progressIndex(s.progress);
    if (at < STEPS.length) return router.replace(STEPS[at]?.path ?? STEPS[0].path);
    let seen = false;
    try {
      seen = sessionStorage.getItem(DONE_SEEN) === "1";
    } catch {
      // Storage blocked: show the done page.
    }
    router.replace(seen ? "/dashboard" : DONE_PATH);
  }, [s.status, s.progress, router]);
  return (
    <p aria-live="polite" className="text-body text-ink-2">
      {s.status === "failed" ? s.error : "Opening your onboarding…"}
    </p>
  );
}
