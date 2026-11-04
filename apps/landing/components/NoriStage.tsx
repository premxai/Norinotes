"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNori } from "@norinote/nori-pet/react";
import "@norinote/nori-pet/style.css";
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

  useEffect(() => {
    if (!pet) return;
    // A handle for checking Nori from the browser console while developing; never in production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { nori: typeof pet }).nori = pet;
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
