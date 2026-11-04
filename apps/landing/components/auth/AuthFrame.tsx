"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SceneFrame } from "@/components/SceneFrame";
import { AUTH_PAGES } from "@/lib/auth-flow";

export function SwitchLink({ className = "" }: { className?: string }) {
  const page = AUTH_PAGES[usePathname()];
  if (!page?.switch) return null;
  return (
    <p className={`text-small text-ink-2 ${className}`}>
      {page.switch.text}{" "}
      <Link href={page.switch.href} className="inline-block py-3 font-semibold text-ink underline decoration-1 underline-offset-[3px] hover:decoration-accent">
        {page.switch.label}
      </Link>
    </p>
  );
}

/** The auth pages' shell (auth spec sections 2 and 6): the gate or nook scene, and the switch link in the top bar. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const scene = AUTH_PAGES[usePathname()]?.scene ?? "nook";
  return (
    <SceneFrame scene={scene} seat="auth" aside={<SwitchLink className="max-tablet:hidden" />}>
      {children}
    </SceneFrame>
  );
}
