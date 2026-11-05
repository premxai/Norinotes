"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNori } from "@norinote/nori-pet/react";
import "@norinote/nori-pet/style.css";
import { startChoreo } from "@/lib/choreo";
import { isAppPath, isAuthPath, isLegalPath, isOnboardingPath } from "@/lib/routes";

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
  // A full error page can replace a page without the address changing; it says so, and Nori chooses its seat again.
  const [seats, setSeats] = useState(0);
  useEffect(() => {
    const again = () => setSeats((n) => n + 1);
    addEventListener("norinote:seats", again);
    return () => removeEventListener("norinote:seats", again);
  }, []);

  useEffect(() => {
    if (!pet) return;
    // A handle for checking Nori from the browser console while developing; never in production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { nori: typeof pet }).nori = pet;
    const arrived = previous.current !== null && previous.current !== path;
    previous.current = path;
    // The auth, onboarding and dashboard pages sit Nori on their scene's seat. That code is loaded only there, so it
    // never weighs on the landing page's first screen.
    // An error page can be at any address (a 404 is wherever the visitor typed), so it's known by its seat, not its path
    // (error pages spec section 7). In the dashboard the shell's own seats are used instead.
    const errorPage = !!document.querySelector('[data-nori-seat="error"]');
    const kind = errorPage ? "error" : isAuthPath(path) ? "auth" : isOnboardingPath(path) ? "onboarding" : isAppPath(path) ? "app" : isLegalPath(path) ? "legal" : null;
    if (kind) {
      let seat: { destroy: () => void } | null = null;
      let gone = false;
      void import("@/lib/seat-nori").then((m) => {
        if (gone) return;
        seat = (kind === "error" ? m.startErrorNori : kind === "auth" ? m.startAuthNori : kind === "onboarding" ? m.startOnboardingNori : kind === "legal" ? m.startLegalNori : m.startAppNori)(pet, { arrived });
      });
      return () => {
        gone = true;
        seat?.destroy();
      };
    }
    const choreo = startChoreo(pet, { onSignup: () => router.push("/signup") });
    const offPet = pet.on("pet", () => {
      if (choreo?.section() === "hero") dispatchEvent(new Event("norinote:note"));
    });
    return () => {
      choreo?.destroy();
      offPet();
    };
  }, [pet, path, router, seats]);

  return null;
}
