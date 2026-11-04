"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Section content rises 12 px and fades in once, when it scrolls into view (spec section 10). Only content that starts
 * below the fold is hidden, and only after the script runs, so nothing is ever stuck invisible and nothing on the first
 * screen flickers. Reduced motion skips it entirely. Children can react with `group-data-[reveal=shown]:`.
 */
export function Reveal({ as: Tag = "div", delay = 0, className = "", children }: { as?: ElementType; delay?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.reveal = "shown";
      return;
    }
    if (el.getBoundingClientRect().top < innerHeight) {
      el.dataset.reveal = "shown";
      return;
    }
    el.dataset.reveal = "hidden";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.reveal = "shown";
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`group reveal ${className}`} style={delay ? { "--delay": `${delay}ms` } : undefined}>
      {children}
    </Tag>
  );
}
