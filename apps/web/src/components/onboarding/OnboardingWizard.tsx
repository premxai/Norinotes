"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight, BadgeCheck, Check, FileText, FileUp, ListChecks, Network, ShieldCheck, SlidersHorizontal, UserRound, type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ONBOARDING_STEPS, type IngestResult, type Lane, type OnboardingStep, type OnboardingStepId, type Preferences, type Profile } from "@/lib/types";
import { Icon, Notice, buttonClass, cx } from "../ui";
import { ResumeStep } from "./ResumeStep";
import { AuthorizationStep, ContactStep, PreferencesStep, ScreeningStep } from "./steps";

type Meta = { id: OnboardingStepId; label: string; icon: LucideIcon; title: string; lead: string; why: string; skippable: boolean };

export const STEP_META: Meta[] = [
  { id: "resume", label: "Resume", icon: FileUp, title: "Start with your resume", lead: "Norinote turns it into facts it can cite.", why: "Every resume line and every answer Norinote writes later must trace to a fact found here. Nothing is invented.", skippable: false },
  { id: "contact", label: "Contact", icon: UserRound, title: "How employers reach you", lead: "Filled in from your resume. Check it.", why: "These go on every form exactly as written here.", skippable: true },
  { id: "authorization", label: "Work authorization", icon: BadgeCheck, title: "Where you can work", lead: "Every US form asks these.", why: "Norinote never guesses legal answers. A gap here makes it stop and ask you on each form.", skippable: true },
  { id: "screening", label: "Screening answers", icon: ListChecks, title: "Answers forms always ask", lead: "Set once, reused on every application.", why: "Salary, start date, how you heard about the role. Answering now saves a question on almost every application.", skippable: true },
  { id: "preferences", label: "Preferences and first lane", icon: SlidersHorizontal, title: "What should Norinote look for?", lead: "This becomes your first lane. You can add more later in Settings.", why: "A lane is a rule for which jobs Norinote may shortlist for you. Without one your shortlist stays empty.", skippable: true },
];

/** Index of the first unfinished step; "done" sits one past the last so every step reads as complete. */
const stepIndex = (s: OnboardingStep) => (s === "done" ? ONBOARDING_STEPS.length : Math.max(0, ONBOARDING_STEPS.indexOf(s)));

/** Fills empty profile fields from the resume's contact block. */
function withPatch(p: Profile, patch: IngestResult["profilePatch"]): Profile {
  const next = { ...p } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v && !next[k]) next[k] = v;
  return next as Profile;
}

const PROMISES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Network, title: "A career graph", text: "Your history becomes facts Norinote can cite." },
  { icon: FileText, title: "Tailored resumes", text: "One page, every line traced to you." },
  { icon: ShieldCheck, title: "You stay in charge", text: "Nothing is sent until you click." },
];

function Steps({ current, furthest, onSelect }: { current: number; furthest: number; onSelect: (i: number) => void }) {
  return (
    <>
      <div className="lg:hidden">
        <p className="text-meta text-muted tnum">Step {current + 1} of {STEP_META.length} · <span className="font-medium text-ink">{STEP_META[current].label}</span></p>
        <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="Set-up steps">
          {STEP_META.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-label={`Step ${i + 1}: ${s.label}`} aria-current={i === current ? "step" : undefined} disabled={i > furthest} onClick={() => onSelect(i)}
                className={cx("block h-1.5 w-full rounded-full", i === current ? "bg-accent" : i < furthest ? "bg-ink" : "bg-line")} />
            </li>
          ))}
        </ol>
      </div>
      <nav aria-label="Set-up steps" className="hidden lg:block">
        <ol className="flex flex-col gap-1">
          {STEP_META.map((s, i) => {
            const isCurrent = i === current;
            const isDone = i < furthest && !isCurrent;
            const reachable = i <= furthest;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  disabled={!reachable}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cx("flex min-h-10 w-full items-center gap-3 rounded-control px-2 text-left", isCurrent ? "bg-sunken font-semibold text-ink" : reachable ? "text-ink-2 hover:bg-sunken/70" : "text-muted")}
                >
                  <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tnum", isDone ? "bg-ink text-on-ink" : isCurrent ? "bg-accent text-on-ink" : "border border-control text-muted")}>
                    {isDone ? <Icon icon={Check} size={13} /> : i + 1}
                  </span>
                  <span className="text-[13.5px]">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 px-2 text-meta text-muted">Every step except the resume can be skipped. Gaps show up on your Profile page.</p>
      </nav>
    </>
  );
}

/** The first lane, built from the preferences just saved. Skipped when the person already has lanes or named no title. */
async function ensureFirstLane(prefs: Preferences | undefined) {
  const titles = prefs?.titles ?? [];
  if (titles.length === 0) return;
  const existing = await api.lanes().catch(() => null);
  if (existing === null || existing.length > 0) return;
  const lane: Lane = {
    id: "new-first", name: titles[0], titles, locations: prefs?.locations ?? [], remote: (prefs?.remote ?? "ok") !== "no", minFit: 0.6, enabled: true,
  };
  await api.saveLanes([lane]);
}

export function OnboardingWizard({ initialStep, serverStep, profile: initialProfile, replayWelcome = false }: {
  initialStep: OnboardingStepId;
  serverStep: OnboardingStep;
  profile: Profile;
  /** `/onboarding?welcome=1` shows the intro again. */
  replayWelcome?: boolean;
}) {
  const router = useRouter();
  const fresh = serverStep === "resume" && initialStep === "resume" && !initialProfile.rawResumeText;
  const [welcome, setWelcome] = useState(fresh || replayWelcome);
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState(ONBOARDING_STEPS.indexOf(initialStep));
  const [furthest, setFurthest] = useState(Math.max(stepIndex(serverStep), ONBOARDING_STEPS.indexOf(initialStep)));
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<number | null>(null);
  const meta = STEP_META[current];
  const first = (profile.fullName ?? "").trim().split(/\s+/)[0] || "there";

  function go(i: number) {
    setCurrent(i);
    setError(null);
    window.history.replaceState(null, "", `/onboarding?step=${ONBOARDING_STEPS[i]}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(data: Record<string, unknown>, base: Profile = profile): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveOnboarding(meta.id, data);
      setProfile({ ...base, ...data, ...(res?.profile ?? {}) } as Profile);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndNext(data: Record<string, unknown>, base?: Profile) {
    if (!(await save(data, base))) return;
    const next = Math.min(current + 1, STEP_META.length - 1);
    setFurthest((f) => Math.max(f, next));
    go(next);
  }

  // The last step saves the preferences, builds the first lane from them and closes the wizard.
  async function finish(data: Record<string, unknown>) {
    if (!(await save(data))) return;
    try { await ensureFirstLane(data.preferences as Preferences | undefined); } catch { /* lanes can be added in Settings */ }
    router.prefetch("/dashboard");
    setDone(true);
    window.scrollTo({ top: 0 });
  }

  function open() {
    router.push("/dashboard");
    router.refresh();
  }

  const back = current > 0 ? () => go(current - 1) : undefined;
  const status = error ? <Notice tone="red">{error}</Notice> : undefined;
  const common = { profile, busy, onBack: back, status, onSubmit: (d: Record<string, unknown>) => saveAndNext(d) };

  // ---------------------------------------------------------------- finish
  if (done) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-10">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-tint text-accent-fg"><Icon icon={Check} size={20} /></span>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">You are set up, {first}</h1>
        <p className="text-[16px] leading-relaxed text-ink-2">Your career graph is ready. Norinote will start shortlisting roles inside your lane, and nothing is sent until you click.</p>
        <button type="button" onClick={open} className={buttonClass({ variant: "primary", size: "lg" }, "mt-2")}>
          Go to your dashboard <Icon icon={ArrowRight} />
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- welcome
  if (welcome) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
        <p className="text-meta text-muted">Set-up takes about ten minutes</p>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">Hi {first}. Five short steps and Norinote can start.</h1>
        <p className="text-[16px] leading-relaxed text-ink-2">It needs your resume, the answers forms always ask, and what you are looking for. You can save and finish later at any point.</p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PROMISES.map((p) => (
            <li key={p.title} className="rounded-card border border-line bg-surface p-4">
              <Icon icon={p.icon} size={18} className="text-ink" />
              <p className="mt-2 text-[14.5px] font-semibold text-ink">{p.title}</p>
              <p className="mt-0.5 text-[13px] text-ink-2">{p.text}</p>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" onClick={() => setWelcome(false)} className={buttonClass({ variant: "primary", size: "lg" })}>
            Start with your resume <Icon icon={ArrowRight} />
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- steps
  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)_260px] lg:gap-10">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Steps current={current} furthest={furthest} onSelect={(i) => i <= furthest && go(i)} />
      </aside>

      <section key={meta.id} className="min-w-0" aria-labelledby="step-title">
        <h1 id="step-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">{meta.title}</h1>
        <p className="mt-1.5 text-body text-ink-2">{meta.lead}</p>
        <div className="mt-6">
          {meta.id === "resume" && (
            <>
              <ResumeStep
                hasResume={!!profile.rawResumeText}
                busy={busy}
                onResult={(r) => setFound(r.nodesCreated)}
                onDone={(r) => saveAndNext({}, r ? withPatch({ ...profile, rawResumeText: profile.rawResumeText ?? "uploaded" }, r.profilePatch) : profile)}
              />
              {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}
            </>
          )}
          {meta.id === "contact" && <ContactStep {...common} />}
          {meta.id === "authorization" && <AuthorizationStep {...common} />}
          {meta.id === "screening" && <ScreeningStep {...common} />}
          {meta.id === "preferences" && <PreferencesStep {...common} submitLabel="Finish set-up" onSubmit={(d) => finish(d)} />}
        </div>
      </section>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-card bg-sunken p-4">
          <p className="text-body-sm font-semibold text-ink">Why this step</p>
          <p className="mt-1 text-meta text-ink-2">{meta.why}</p>
        </div>
        {meta.id === "resume" && found != null && (
          <div className="rounded-card bg-accent-tint p-4 text-accent-fg">
            <p className="text-body-sm font-semibold">Found {found} facts</p>
            <p className="mt-1 text-meta">Each keeps the line it came from. You can review them on the Career graph page.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
