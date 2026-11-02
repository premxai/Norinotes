import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { ONBOARDING_STEPS, type OnboardingState, type OnboardingStepId } from "@/lib/types";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const metadata: Metadata = { title: "Set up" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string | string[]; welcome?: string | string[] }> }) {
  const sp = await searchParams;
  const replay = (Array.isArray(sp.welcome) ? sp.welcome[0] : sp.welcome) === "1";
  const asked = (Array.isArray(sp.step) ? sp.step[0] : sp.step) as OnboardingStepId | undefined;

  const res = await api.onboarding().catch((e: unknown) => e);
  if (res instanceof ApiError && res.status === 401) redirect("/login?next=/onboarding");
  let state: OnboardingState;
  if (res instanceof Error) {
    // An API without the onboarding route yet: start from the current profile.
    const me = await api.me();
    state = { step: "resume", profile: me.profile };
  } else {
    state = res as OnboardingState;
  }

  // Resume where the user left off; a finished user (or ?step=) can revisit any step.
  const initial: OnboardingStepId = asked && ONBOARDING_STEPS.includes(asked)
    ? asked
    : state.step === "done" ? "resume" : state.step;

  return <OnboardingWizard initialStep={initial} serverStep={state.step} profile={state.profile} replayWelcome={replay} />;
}
