"use client";

import { useEffect, useState } from "react";
import { api, type ApplicationRow, type Outcomes } from "@/lib/api";
import { isSent } from "@/lib/app-state";

/*
 * Every sent application's outcomes (4b spec sections 3 and 9). The list endpoint doesn't carry them, so they're fetched
 * one application at a time: newest first, at most 6 at once, kept for the visit and fetched again only when the
 * application or its mail changes (its stamp), or after a change made here.
 */

const POOL = 6;
const cache = new Map<string, { stamp: string; data: Outcomes }>();
const inflight = new Set<string>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => fn());

/** After marking or undoing: the API answers with the new outcomes, which replace the cached ones. */
export function setOutcomes(id: string, data: Outcomes) {
  cache.set(id, { stamp: cache.get(id)?.stamp ?? "", data });
  notify();
}
export const cachedOutcomes = (id: string) => cache.get(id)?.data;

/** `stamps` adds to each application's own (its last update): the newest linked message, so new mail refetches it. */
export function useOutcomes(rows: ApplicationRow[] | null, stamps: Map<string, string> = new Map()) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    subs.add(fn);
    return () => void subs.delete(fn);
  }, []);

  const wanted = (rows ?? []).filter((r) => isSent(r.application)).map((r) => ({ id: r.application.id, stamp: `${r.application.updatedAt}|${stamps.get(r.application.id) ?? ""}` }));
  const signature = wanted.map((w) => `${w.id}:${w.stamp}`).join(",");

  useEffect(() => {
    let live = true;
    const queue = signature
      .split(",")
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(":");
        return { id: s.slice(0, i), stamp: s.slice(i + 1) };
      })
      .filter((w) => cache.get(w.id)?.stamp !== w.stamp && !inflight.has(w.id));
    const worker = async () => {
      for (let w = queue.shift(); w && live; w = queue.shift()) {
        inflight.add(w.id);
        const r = await api.outcomes(w.id);
        inflight.delete(w.id);
        if (r.ok) {
          cache.set(w.id, { stamp: w.stamp, data: r.data });
          notify();
        }
      }
    };
    for (let i = 0; i < Math.min(POOL, queue.length); i++) void worker();
    return () => {
      live = false;
    };
  }, [signature]);

  const map = new Map<string, Outcomes>();
  for (const w of wanted) {
    const c = cache.get(w.id);
    if (c) map.set(w.id, c.data);
  }
  return { map, loaded: !!rows && wanted.every((w) => cache.has(w.id)) };
}
