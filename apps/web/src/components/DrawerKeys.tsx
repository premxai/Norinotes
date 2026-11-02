"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keyboard behaviour for the server-rendered job drawer: Escape closes it, focus moves into it on open and returns to the opener on close. */
export function DrawerKeys({ closeHref, focusId }: { closeHref: string; focusId: string }) {
  const router = useRouter();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    document.getElementById(focusId)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [router, closeHref, focusId]);
  return null;
}
