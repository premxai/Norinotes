"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNori } from "@norinote/nori-pet/react";
import "@norinote/nori-pet/style.css";
import { isAuthPath } from "@/lib/auth-flow";
import { startAuthNori, startOnboardingNori } from "@/lib/seat-nori";
import { startChoreo } from "@/lib/choreo";

/**
 * Mounts Nori once, from the root layout, so it carries over between pages. Its sprites are copied into public/nori/
 * by `npm run nori-assets`. On each page the choreography (lib/choreo.ts) decides where Nori sits and what it does;
 * on the hero, clicking Nori opens its note.
 */
export function NoriStage() {
  // Lazy: the landing page fetches each section's rows ahead of it, not all 45 strips at once (about 2.6 MB).
  const pet = useNori({ assets: "/nori/", storageKey: "norinote-landing", preload: "lazy" });
  const path = usePathname();
  const router = useRouter();

  // The page Nori was last on, so the auth pages know whether it walked in from another page or this is a fresh visit.
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (!pet) return;
    // A handle for checking Nori from the browser console while developing; never in production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { nori: typeof pet }).nori = pet;
    const arrived = previous.current !== null && previous.current !== path;
    previous.current = path;
    if (isAuthPath(path) || path.startsWith("/onboarding")) {
      const seat = (isAuthPath(path) ? startAuthNori : startOnboardingNori)(pet, { arrived });
      return () => seat.destroy();
    }
    const choreo = startChoreo(pet, { onSignup: () => router.push("/signup") });
    const offPet = pet.on("pet", () => {
      if (choreo?.section() === "hero") dispatchEvent(new Event("norinote:note"));
    });
    return () => {
      choreo?.destroy();
      offPet();
    };
  }, [pet, path, router]);

  return null;
}
