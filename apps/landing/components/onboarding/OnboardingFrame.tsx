"use client";

import { useEffect, type ReactNode } from "react";
import { SceneFrame } from "@/components/SceneFrame";
import { loadOnboarding } from "@/lib/onboarding";

/**
 * Onboarding's shell (onboarding spec section 2): the workshop scene with Nori's bench seat, a 560 px column aligned to
 * the top, and "Saved as you go". Entering onboarding loads the saved progress and profile afresh.
 */
export function OnboardingFrame({ children }: { children: ReactNode }) {
  useEffect(() => {
    void loadOnboarding({ fresh: true });
  }, []);
  return (
    <SceneFrame scene="workshop" seat="onboarding" layout="top" aside={<p className="text-small text-ink-2 max-tablet:text-[0.8125rem]">Saved as you go</p>}>
      {children}
    </SceneFrame>
  );
}
