"use client";

import { useEffect } from "react";

/**
 * Marks the page settled (`html.settled`) once it has loaded and gone quiet, which ends the first-paint shortcut in
 * globals.css: from then on every section is laid out for real. A visitor who scrolls or tabs before that only meets
 * sections the browser renders on demand anyway.
 */
export function Settle() {
  useEffect(() => {
    const root = document.documentElement;
    let t = 0;
    const done = () => root.classList.add("settled");
    const go = () => {
      t = window.setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(done, { timeout: 2000 }) : done()), 1200);
    };
    if (document.readyState === "complete") go();
    else addEventListener("load", go, { once: true });
    return () => {
      clearTimeout(t);
      removeEventListener("load", go);
    };
  }, []);
  return null;
}
