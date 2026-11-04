import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";

/** Every onboarding step shares one shell, so the workshop scene and Nori stay put between steps. */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingFrame>{children}</OnboardingFrame>;
}
