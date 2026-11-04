"use client";

import { useSyncExternalStore } from "react";

/* The dashboard's theme (4a spec section 4), shared by the account menu and You's Account page (4c spec section 6):
   one store, so picking it in either place updates the other at once. */

export type Theme = "system" | "light" | "dark";
const THEME_KEY = "norinote-theme";
const themeSubs = new Set<() => void>();
const readTheme = (): Theme => {
  const t = document.documentElement.getAttribute("data-app-theme");
  return t === "light" || t === "dark" ? t : "system";
};
export function setTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-app-theme");
  else document.documentElement.setAttribute("data-app-theme", t);
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
  themeSubs.forEach((fn) => fn());
}
export const useTheme = () =>
  useSyncExternalStore(
    (fn) => {
      themeSubs.add(fn);
      return () => void themeSubs.delete(fn);
    },
    readTheme,
    () => "system" as Theme,
  );

