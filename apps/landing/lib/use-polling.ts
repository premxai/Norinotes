"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Result } from "@/lib/api";

/**
 * Fetches now and again after each answer, while the tab is visible (4a spec sections 7 and 12): paused while hidden,
 * fetched again on return, and never two requests at once. `every` can depend on the latest data (2 s while an
 * application moves, 30 s otherwise). A null key stops it.
 */
export function usePolling<T>(key: string | null, fetcher: () => Promise<Result<T>>, every: number | ((data: T | null) => number)) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; status: number }>({ key: null, data: null, error: null, status: 0 });
  const run = useRef<() => Promise<void>>(async () => {});
  const latest = useRef({ fetcher, every });
  useEffect(() => {
    latest.current = { fetcher, every };
  });

  useEffect(() => {
    if (!key) return;
    let live = true;
    let busy = false;
    let timer = 0;
    let data: T | null = null;
    const next = () => {
      clearTimeout(timer);
      const { every: e } = latest.current;
      timer = window.setTimeout(() => void run.current(), typeof e === "function" ? e(data) : e);
    };
    run.current = async () => {
      if (busy) return;
      if (document.hidden) return next();
      busy = true;
      const r = await latest.current.fetcher();
      busy = false;
      if (!live) return;
      if (r.ok) data = r.data;
      setState((s) => (r.ok ? { key, data: r.data, error: null, status: r.status } : { key, data: s.key === key ? s.data : null, error: r.error, status: r.status }));
      next();
    };
    void run.current();
    const onShow = () => {
      if (!document.hidden) void run.current();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [key]);

  const refresh = useCallback(() => run.current(), []);
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, status: fresh ? state.status : 0, loading: !fresh, refresh };
}
