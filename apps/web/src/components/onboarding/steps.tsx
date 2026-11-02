"use client";

import { useState, type ReactNode } from "react";
import type { Eeo, Profile, SalaryExpectation, WorkStatus } from "@/lib/types";
import { Field, cx, inputClass } from "../ui";
import { ChipInput, Group, PillSelect, Question, Segmented, StepFooter, YesNo } from "./controls";

export type StepProps = {
  profile: Profile;
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  busy?: boolean;
  onBack?: () => void;
  submitLabel?: string;
  status?: ReactNode;
};

const s = (v: string | null | undefined) => v ?? "";
const orNull = (v: string) => (v.trim() ? v.trim() : null);

// ------------------------------------------------------------------ 02 contact
export function ContactStep({ profile, onSubmit, busy, onBack, submitLabel, status }: StepProps) {
  const [city0, state0] = (profile.location ?? "").split(",").map((x) => x.trim());
  const [f, setF] = useState({
    fullName: s(profile.fullName),
    email: s(profile.email),
    phone: s(profile.phone),
    city: s(profile.city) || s(city0),
    state: s(profile.state) || s(state0),
    country: s(profile.country) || "United States",
    linkedin: s(profile.linkedin),
    github: s(profile.github),
    website: s(profile.website),
    pronouns: s(profile.pronouns),
  });
  const input = (k: keyof typeof f, label: string, opts: { type?: string; required?: boolean; placeholder?: string; auto?: string; className?: string } = {}) => (
    <Field label={<>{label}{opts.required && <span className="ml-1 text-danger-fg">*</span>}</>} className={opts.className}>
      <input
        className={inputClass}
        type={opts.type ?? "text"}
        required={opts.required}
        placeholder={opts.placeholder}
        autoComplete={opts.auto}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </Field>
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const location = [f.city, f.state].map((x) => x.trim()).filter(Boolean).join(", ") || null;
    onSubmit({
      fullName: f.fullName.trim(), email: f.email.trim(), phone: orNull(f.phone), city: orNull(f.city), state: orNull(f.state),
      country: orNull(f.country), linkedin: orNull(f.linkedin), github: orNull(f.github), website: orNull(f.website),
      pronouns: orNull(f.pronouns), location,
    });
  }
  return (
    <form onSubmit={submit}>
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-6">
        {input("fullName", "Full name", { required: true, auto: "name", className: "sm:col-span-4" })}
        {input("pronouns", "Pronouns", { placeholder: "Optional", className: "sm:col-span-2" })}
        {input("email", "Email", { type: "email", required: true, auto: "email", className: "sm:col-span-3" })}
        {input("phone", "Phone", { type: "tel", auto: "tel", className: "sm:col-span-3" })}
        {input("city", "City", { auto: "address-level2", className: "sm:col-span-2" })}
        {input("state", "State", { auto: "address-level1", className: "sm:col-span-2" })}
        {input("country", "Country", { auto: "country-name", className: "sm:col-span-2" })}
        {input("linkedin", "LinkedIn", { type: "url", placeholder: "https://linkedin.com/in/...", className: "sm:col-span-3" })}
        {input("github", "GitHub", { type: "url", placeholder: "https://github.com/...", className: "sm:col-span-3" })}
        {input("website", "Website", { type: "url", placeholder: "https://", className: "sm:col-span-6" })}
      </div>
      <StepFooter busy={busy} onBack={onBack} label={submitLabel} status={status} />
    </form>
  );
}

// ------------------------------------------------------------------ 03 authorization
const STATUS_OPTIONS: { value: WorkStatus; label: string }[] = [
  { value: "citizen", label: "Citizen" },
  { value: "permanent_resident", label: "Permanent resident" },
  { value: "visa", label: "Visa" },
  { value: "other", label: "Other" },
];
const REMOTE_PREF = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
  { value: "any", label: "Any" },
];

export function AuthorizationStep({ profile, onSubmit, busy, onBack, submitLabel, status }: StepProps) {
  const wa = profile.workAuth ?? {};
  const [authorizedUS, setAuthorizedUS] = useState<boolean | undefined>(wa.authorizedUS);
  const [workStatus, setWorkStatus] = useState<WorkStatus | undefined>(wa.status);
  const [visaType, setVisaType] = useState(s(wa.visaType));
  const [needsSponsorship, setNeedsSponsorship] = useState<boolean | undefined>(wa.needsSponsorship);
  const [relocate, setRelocate] = useState<boolean | undefined>(profile.willingToRelocate ?? undefined);
  const [remotePreference, setRemotePreference] = useState(profile.remotePreference ?? "any");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      workAuth: { ...wa, authorizedUS, status: workStatus, visaType: workStatus === "visa" ? orNull(visaType) : null, needsSponsorship },
      willingToRelocate: relocate ?? null,
      remotePreference,
    });
  }
  return (
    <form onSubmit={submit}>
      <div className="border-y border-line">
        <Question label="Authorized to work in the US?">
          <YesNo label="Authorized to work in the US" value={authorizedUS} onChange={setAuthorizedUS} />
        </Question>
        <Question label="Status">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Work status" value={workStatus} onChange={setWorkStatus} options={STATUS_OPTIONS} />
            {workStatus === "visa" && (
              <input aria-label="Visa type" className={cx(inputClass, "w-36")} placeholder="e.g. H-1B" value={visaType} onChange={(e) => setVisaType(e.target.value)} />
            )}
          </div>
        </Question>
        <Question label="Need sponsorship now or later?">
          <YesNo label="Needs sponsorship" value={needsSponsorship} onChange={setNeedsSponsorship} />
        </Question>
        <Question label="Willing to relocate?">
          <YesNo label="Willing to relocate" value={relocate} onChange={setRelocate} />
        </Question>
        <Question label="Remote preference">
          <Segmented label="Remote preference" value={remotePreference} onChange={setRemotePreference} options={REMOTE_PREF} />
        </Question>
      </div>
      <StepFooter busy={busy} onBack={onBack} label={submitLabel} status={status} />
    </form>
  );
}

// ------------------------------------------------------------------ 04 screening
const HEARD = ["Job board", "LinkedIn", "Company website", "Referral", "Recruiter", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "INR", "AUD"];
const PERIODS: { value: NonNullable<SalaryExpectation["period"]>; label: string }[] = [
  { value: "year", label: "per year" }, { value: "month", label: "per month" }, { value: "hour", label: "per hour" },
];
const CLEARANCE = [
  { value: "none", label: "None" }, { value: "confidential", label: "Confidential" }, { value: "secret", label: "Secret" },
  { value: "top_secret", label: "Top Secret" }, { value: "ts_sci", label: "TS/SCI" },
];
const DECLINE = { value: "decline", label: "Prefer not to say" };
const EEO_FIELDS: { key: keyof Eeo; label: string; options: { value: string; label: string }[] }[] = [
  { key: "gender", label: "Gender", options: [DECLINE, { value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "non_binary", label: "Non-binary" }] },
  {
    key: "race", label: "Race / ethnicity", options: [
      DECLINE, { value: "american_indian", label: "American Indian or Alaska Native" }, { value: "asian", label: "Asian" },
      { value: "black", label: "Black or African American" }, { value: "hispanic", label: "Hispanic or Latino" },
      { value: "pacific_islander", label: "Native Hawaiian or Pacific Islander" }, { value: "white", label: "White" },
      { value: "two_or_more", label: "Two or more races" },
    ],
  },
  { key: "veteran", label: "Veteran status", options: [DECLINE, { value: "not_veteran", label: "Not a veteran" }, { value: "veteran", label: "Veteran" }, { value: "protected_veteran", label: "Protected veteran" }] },
  { key: "disability", label: "Disability", options: [DECLINE, { value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
];

export function ScreeningStep({ profile, onSubmit, busy, onBack, submitLabel, status }: StepProps) {
  const sal = profile.salaryExpectation ?? {};
  const [heardAbout, setHeardAbout] = useState(profile.heardAbout ?? "Job board");
  const [amount, setAmount] = useState(sal.amount != null ? String(sal.amount) : "");
  const [currency, setCurrency] = useState(sal.currency ?? "USD");
  const [period, setPeriod] = useState<NonNullable<SalaryExpectation["period"]>>(sal.period ?? "year");
  const [start, setStart] = useState(s(profile.earliestStartDate));
  const [notice, setNotice] = useState(profile.noticePeriodWeeks != null ? String(profile.noticePeriodWeeks) : "2");
  const [over18, setOver18] = useState<boolean>(profile.over18 ?? true);
  const [clearance, setClearance] = useState(profile.securityClearance ?? "none");
  const [eeo, setEeo] = useState<Eeo>({ gender: "decline", race: "decline", veteran: "decline", disability: "decline", ...(profile.eeo ?? {}) });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      heardAbout,
      // Blank means "no preference": send null, never an amount of null.
      salaryExpectation: amount && Number.isFinite(Number(amount)) ? { amount: Number(amount), currency, period } : null,
      earliestStartDate: orNull(start),
      noticePeriodWeeks: notice === "" ? null : Math.max(0, Number(notice)),
      over18,
      securityClearance: clearance,
      eeo,
    });
  }
  return (
    <form onSubmit={submit} className="space-y-8">
      <Group letter="A" title="Pay and timing">
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-6">
          <Field label="Salary expectation" className="sm:col-span-6">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_8rem] gap-2">
              <input className={cx(inputClass, "tnum")} type="number" min={0} step={1000} placeholder="180000" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select aria-label="Currency" className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select aria-label="Period" className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Earliest start" className="sm:col-span-2">
            <input className={cx(inputClass, "tnum")} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Notice (weeks)" className="sm:col-span-2">
            <input className={cx(inputClass, "tnum")} type="number" min={0} max={52} value={notice} onChange={(e) => setNotice(e.target.value)} />
          </Field>
          <Field label="Heard about the role" className="sm:col-span-2">
            <select className={inputClass} value={heardAbout} onChange={(e) => setHeardAbout(e.target.value)}>
              {[...HEARD, ...(HEARD.includes(heardAbout) ? [] : [heardAbout])].map((h) => <option key={h}>{h}</option>)}
            </select>
          </Field>
        </div>
      </Group>

      <Group letter="B" title="Eligibility">
        <div className="-mt-1">
          <Question label="18 or older?">
            <YesNo label="Over 18" value={over18} onChange={setOver18} />
          </Question>
          <Question label="Security clearance">
            <select aria-label="Security clearance" className={cx(inputClass, "sm:w-44")} value={clearance} onChange={(e) => setClearance(e.target.value)}>
              {CLEARANCE.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Question>
        </div>
      </Group>

      <Group letter="C" title="Voluntary self-identification" note="Only sent when a form requires an answer.">
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          {EEO_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <select className={inputClass} value={eeo[f.key] ?? "decline"} onChange={(e) => setEeo({ ...eeo, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </Group>

      <StepFooter busy={busy} onBack={onBack} label={submitLabel} status={status} />
    </form>
  );
}

// ------------------------------------------------------------------ 05 preferences
const STAGES = ["Seed", "Series A", "Series B", "Series C+", "Growth", "Public"];
const REMOTE: { value: "only" | "ok" | "no"; label: string }[] = [
  { value: "only", label: "Remote only" }, { value: "ok", label: "Remote is fine" }, { value: "no", label: "No remote" },
];

export function PreferencesStep({ profile, onSubmit, busy, onBack, submitLabel, status }: StepProps) {
  const p = profile.preferences ?? {};
  const [titles, setTitles] = useState<string[]>(p.titles ?? []);
  const [locations, setLocations] = useState<string[]>(p.locations ?? []);
  const [remote, setRemote] = useState<"only" | "ok" | "no">(p.remote ?? "ok");
  const [salaryMin, setSalaryMin] = useState(p.salaryMin != null ? String(p.salaryMin) : "");
  const [stages, setStages] = useState<string[]>(p.stages ?? []);
  const [exclude, setExclude] = useState<string[]>(p.excludeCompanies ?? []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      preferences: { ...p, titles, locations, remote, salaryMin: salaryMin ? Number(salaryMin) : undefined, stages, excludeCompanies: exclude },
    });
  }
  return (
    <form onSubmit={submit} className="space-y-8">
      <Group letter="A" title="Roles">
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          <Field label="Target titles" className="sm:col-span-2">
            <ChipInput label="Add a title" value={titles} onChange={setTitles} placeholder="Type a title, press Enter" />
          </Field>
          <Field label="Locations">
            <ChipInput label="Add a location" value={locations} onChange={setLocations} placeholder="San Francisco" />
          </Field>
          <Field label="Minimum salary (USD)">
            <input className={cx(inputClass, "tnum")} type="number" min={0} step={5000} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-meta font-medium text-ink-2">Remote</span>
            <Segmented label="Remote" value={remote} onChange={setRemote} options={REMOTE} />
          </div>
        </div>
      </Group>
      <Group letter="B" title="Companies">
        <div className="space-y-5">
          <div>
            <span className="mb-2 block text-meta font-medium text-ink-2">Stages</span>
            <PillSelect value={stages} onChange={setStages} options={STAGES} />
          </div>
          <Field label="Exclude companies">
            <ChipInput label="Add a company to exclude" value={exclude} onChange={setExclude} placeholder="Current employer" />
          </Field>
        </div>
      </Group>
      <StepFooter busy={busy} onBack={onBack} label={submitLabel} status={status} />
    </form>
  );
}
