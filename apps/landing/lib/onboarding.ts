"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { api, type GraphNode, type Ingest, type Profile, type Progress, type StepId } from "@/lib/api";

/*
 * Onboarding's state (onboarding spec sections 8 and 9): the saved progress and profile from `GET /api/onboarding`, the
 * resume just read, and each step's unsaved values (so Back never loses them). It lives in this module for the visit,
 * shared by every step, and is loaded again each time someone enters onboarding.
 */

export const STEPS = [
  { id: "resume", api: "resume", name: "Resume", path: "/onboarding/resume" },
  { id: "contact", api: "contact", name: "Contact", path: "/onboarding/contact" },
  { id: "work", api: "authorization", name: "Work", path: "/onboarding/work" },
  { id: "questions", api: "screening", name: "Questions", path: "/onboarding/questions" },
  { id: "preferences", api: "preferences", name: "Preferences", path: "/onboarding/preferences" },
] as const satisfies readonly { id: string; api: StepId; name: string; path: string }[];

export const DONE_PATH = "/onboarding/done";

/** 0 to 4 for the steps, 5 once onboarding is done. */
export const progressIndex = (p: Progress) => (p === "done" ? STEPS.length : STEPS.findIndex((s) => s.api === p));

type State = {
  status: "idle" | "loading" | "ready" | "signed-out" | "failed";
  error: string | null;
  progress: Progress;
  profile: Profile | null;
  /** The resume read in this visit: its contact details and note. */
  ingest: Ingest | null;
  /** The career graph's nodes, from the read or from `GET /api/graph`. */
  nodes: GraphNode[] | null;
  drafts: Record<string, unknown>;
};

const INITIAL: State = { status: "idle", error: null, progress: "resume", profile: null, ingest: null, nodes: null, drafts: {} };
let state: State = INITIAL;
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useOnboarding = () => useSyncExternalStore(subscribe, () => state, () => INITIAL);

/** Loads the saved progress and profile; `fresh` starts over (entering onboarding, possibly as someone else). */
export async function loadOnboarding({ fresh = false } = {}) {
  if (!fresh && (state.status === "loading" || state.status === "ready")) return;
  set(fresh ? { ...INITIAL, status: "loading" } : { status: "loading", error: null });
  const r = await api.onboarding();
  if (r.ok) set({ status: "ready", progress: r.data.step, profile: r.data.profile });
  else set(r.status === 401 ? { status: "signed-out" } : { status: "failed", error: r.error });
}

/** Saves one step; on success the progress and profile are updated for every step. */
export async function saveStep(step: StepId, data: Record<string, unknown>) {
  const r = await api.saveStep(step, data);
  if (r.ok) {
    set({ progress: r.data.step, profile: r.data.profile });
    focusNextHeading = true;
  }
  return r;
}

export const setIngest = (ingest: Ingest | null) => set({ ingest, nodes: ingest?.nodes ?? null });
export const setNodes = (nodes: GraphNode[] | null) => set({ nodes });
export const setDraft = (step: string, value: unknown) => {
  state = { ...state, drafts: { ...state.drafts, [step]: value } };
};
export const draftOf = <T>(step: string): T | undefined => state.drafts[step] as T | undefined;

/** Set by a successful save, so the next step's headline takes focus (screen readers start at the top). */
export let focusNextHeading = false;
export const takeFocusNext = () => {
  const v = focusNextHeading;
  focusNextHeading = false;
  return v;
};

/**
 * Keeps a step page honest (spec section 9): signed out goes to sign-in, and a step ahead of the saved progress goes
 * back to the saved one. Steps behind it are allowed.
 */
export function useStepGuard(index: number) {
  const s = useOnboarding();
  const router = useRouter();
  useEffect(() => {
    if (s.status === "signed-out") router.replace("/signin?next=/onboarding");
    else if (s.status === "ready") {
      const at = progressIndex(s.progress);
      if (index > at) router.replace(at >= STEPS.length ? DONE_PATH : (STEPS[at]?.path ?? STEPS[0].path));
    }
  }, [s.status, s.progress, index, router]);
  return s;
}
