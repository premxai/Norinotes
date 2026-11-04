import { api } from "@/lib/api";
import { isAuthPath } from "@/lib/routes";

/*
 * What the auth pages share (auth-design-spec.md section 9): which scene and switch link each page gets, the checks on
 * submit, where to go after signing in, and the few things carried between pages. Carried values live in this module
 * only, so they survive client-side navigation but never reach the URL or storage.
 */

export type AuthScene = "gate" | "nook";

export const AUTH_PAGES: Record<string, { scene: AuthScene; switch: { text: string; label: string; href: string } | null }> = {
  "/signup": { scene: "gate", switch: { text: "Have an account?", label: "Sign in", href: "/signin" } },
  "/signin": { scene: "nook", switch: { text: "New here?", label: "Create an account", href: "/signup" } },
  "/forgot-password": { scene: "nook", switch: { text: "Remembered it?", label: "Sign in", href: "/signin" } },
  "/reset-password": { scene: "nook", switch: { text: "Remembered it?", label: "Sign in", href: "/signin" } },
  "/verify-email": { scene: "gate", switch: null },
};

export { isAuthPath };

/** The email typed on one auth page, offered on the next (WCAG 3.3.7), and the plan picked on the landing page. */
export const carried = { email: "", plan: null as "pro" | null };

export const checkEmail = (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : "Enter an email address, like name@example.com");
export const checkNewPassword = (v: string) => (v.length >= 8 ? null : "Use at least 8 characters");
export const checkPassword = (v: string) => (v ? null : "Enter your password");

/** A `?next=` path to return to after signing in, if it's one of ours: one leading slash, and not an auth page. */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  const path = raw.split(/[?#]/)[0] ?? raw;
  return isAuthPath(path) ? null : raw;
}

/** Where a signed-in person goes: `next` if given, the dashboard once onboarding is done, onboarding before that. */
export async function signedInHome(next: string | null = null): Promise<string> {
  if (next) return next;
  return (await api.onboardingStep()) === "done" ? "/dashboard" : "/onboarding";
}

/** Reads a query parameter once, and optionally removes it from the address bar (email-link tokens). */
export function takeParam(name: string, { remove = false } = {}): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(name);
  if (remove && value !== null) {
    url.searchParams.delete(name);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
  return value;
}

/**
 * Asks Nori to react, through the page's seat controller (lib/seat-nori.ts). Resolves when the reaction has played, or
 * after `wait` ms, whichever is first, so a missing or tucked Nori never holds a page up.
 */
export function noriReact(detail: { event?: string; row?: string; say?: string }, wait = 1200): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, wait);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    dispatchEvent(new CustomEvent("norinote:react", { detail: { ...detail, done } }));
  });
}

/** Tells the seat controller the form's fields changed, so Nori re-wires reading along and covering its eyes. */
export const noriFields = () => dispatchEvent(new Event("norinote:fields"));

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
