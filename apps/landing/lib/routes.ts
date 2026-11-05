/*
 * Which part of the app a path belongs to. Kept apart from the API code, so the root layout's Nori stage can decide
 * what to load without pulling the auth, onboarding or dashboard code into the landing page.
 */

export const AUTH_PATHS = ["/signup", "/signin", "/forgot-password", "/reset-password", "/verify-email"] as const;

export const isAuthPath = (path: string) => (AUTH_PATHS as readonly string[]).includes(path);
export const isOnboardingPath = (path: string) => path === "/onboarding" || path.startsWith("/onboarding/");
/** The dashboard's sections (4a spec section 1). */
export const isAppPath = (path: string) => /^\/(today|applications|inbox|you)(\/|$)/.test(path);
/** The privacy policy and the terms (legal pages spec section 7). */
export const isLegalPath = (path: string) => path === "/privacy" || path === "/terms";
