"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { noriFields, noriReact, safeNext, signedInHome, takeParam } from "@/lib/auth-flow";

type Failure = { text: string; link?: { href: string; label: string } };

/** Nori's short line for an API answer; the full message is always in the form (auth spec section 8). */
function noriLine(status: number) {
  if (status === 401) return "That didn't match.";
  if (status === 409) return "You already have an account!";
  if (status === 429) return "Let's wait a little.";
  if (status === 400) return "That link is too old.";
  if (status === 0) return "I can't reach Norinote.";
  return "Something went wrong.";
}

/**
 * The state every auth form shares: checks on submit (focus goes to the first problem), the busy and done phases,
 * the error box, and Nori's reactions to each.
 */
export function useAuthForm() {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [failure, setFailure] = useState<Failure | null>(null);

  // Nori re-wires reading along and covering its eyes whenever the fields on screen change.
  useEffect(() => {
    noriFields();
  }, [phase]);

  return {
    phase,
    busy: phase === "busy",
    errors,
    failure,
    /** Clears a field's error as soon as it's edited. */
    edited(key: string) {
      if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
    },
    /** Returns true when every field passes; otherwise shows the errors and focuses the first. */
    check(fields: [key: string, error: string | null, ref: RefObject<HTMLInputElement | null>][]) {
      const bad = fields.filter(([, error]) => error);
      setErrors(Object.fromEntries(fields.map(([k, error]) => [k, error])));
      if (!bad.length) return true;
      setFailure(null);
      bad[0]?.[2].current?.focus();
      void noriReact({ event: "auth-failed", say: "Just one thing to fix." });
      return false;
    },
    start() {
      setFailure(null);
      setPhase("busy");
      void noriReact({ event: "signing-in" });
    },
    fail(failure: Failure, status: number) {
      setFailure(failure);
      setPhase("idle");
      void noriReact({ event: "auth-failed", say: noriLine(status) });
    },
    succeed: () => setPhase("done"),
  };
}

const never = () => () => {};

/** A query parameter, read after hydration (the pages are prerendered without one). */
export function useQueryParam(name: string) {
  return useSyncExternalStore(never, () => new URLSearchParams(location.search).get(name), () => null);
}

/*
 * The one-time token in an email link (?token=…). It's read once after hydration and taken out of the address bar at
 * once (auth spec section 9), so it isn't left in history or passed on. A later visit with a new link replaces it.
 */
let linkToken: string | null | undefined;
const linkSubs = new Set<() => void>();
const linkStore = {
  subscribe(fn: () => void) {
    linkSubs.add(fn);
    return () => void linkSubs.delete(fn);
  },
  read() {
    const fresh = takeParam("token", { remove: true });
    if (fresh !== null || linkToken === undefined) linkToken = fresh;
    linkSubs.forEach((fn) => fn());
  },
};

/** undefined until read, then the token, or null when the link had none. */
export function useLinkToken() {
  const token = useSyncExternalStore(linkStore.subscribe, () => linkToken, () => undefined);
  useEffect(() => linkStore.read(), []);
  return token;
}

/** Sign-in and sign-up send someone who's already signed in on to where signing in would take them. */
export function useSignedInRedirect() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    void api.session().then(async (r) => {
      if (!r.ok || !live) return;
      const home = await signedInHome(safeNext(new URLSearchParams(location.search).get("next")));
      if (live) router.replace(home);
    });
    return () => {
      live = false;
    };
  }, [router]);
}
