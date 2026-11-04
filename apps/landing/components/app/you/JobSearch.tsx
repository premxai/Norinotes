"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { ChipsInput } from "@/components/onboarding/controls";
import { api, type Lane } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { CARD, DANGER_BUTTON, H2, HINT, Status, Switch } from "./YouTabs";

/* /you/search: the lanes and what applies to every lane (4c spec section 4). */

type Draft = { key: string; id: string | null; name: string; titles: string[]; locations: string[]; remote: boolean; fit: number; enabled: boolean };
const MAX_LANES = 20;
let nextKey = 0;
const fitOf = (minFit: number) => Math.min(90, Math.max(50, Math.round((minFit * 100) / 5) * 5));
const toDraft = (l: Lane): Draft => ({ key: `k${nextKey++}`, id: l.id, name: l.name, titles: l.titles, locations: l.locations, remote: l.remote, fit: fitOf(l.minFit), enabled: l.enabled });

/** Asks before leaving with unsaved changes: closing the tab, and links inside the app (4c spec section 4). */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || a.getAttribute("target") === "_blank" || e.defaultPrevented) return;
      if (!confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

export function JobSearch() {
  const [lanes, setLanes] = useState<Draft[] | null>(null);
  const [salary, setSalary] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    void Promise.all([api.lanes(), api.me()]).then(([l, me]) => {
      if (!l.ok) return setError(l.error);
      setLanes(l.data.map(toDraft));
      if (me.ok) {
        const p = me.data.profile.preferences;
        setSalary(p.salaryMin ? p.salaryMin.toLocaleString("en-US") : "");
        setSkip(p.excludeCompanies ?? []);
      }
    });
  }, []);
  useLeaveGuard(dirty);
  useEffect(() => {
    if (!focusKey.current) return;
    document.getElementById(`lane-name-${focusKey.current}`)?.focus();
    focusKey.current = null;
  });

  const edit = (key: string, patch: Partial<Draft>) => {
    setLanes((ls) => ls?.map((l) => (l.key === key ? { ...l, ...patch } : l)) ?? null);
    setDirty(true);
    setMsg(null);
  };

  async function save() {
    if (!lanes || busy) return;
    setTried(true);
    if (lanes.some((l) => !l.name.trim())) return setMsg(null);
    setBusy(true);
    const r = await api.saveLanes(lanes.map((l) => ({ id: l.id, name: l.name.trim(), titles: l.titles, locations: l.locations, remote: l.remote, minFit: l.fit / 100, enabled: l.enabled })));
    if (!r.ok) {
      setBusy(false);
      return setMsg({ text: r.error, tone: "error" });
    }
    const min = Number(salary.replace(/[^\d.]/g, ""));
    // The API keeps no "unset" for the lowest salary; 0 lets every job through.
    const p = await api.saveProfile({ preferences: { salaryMin: min > 0 ? min : 0, excludeCompanies: skip } });
    setBusy(false);
    if (!p.ok) return setMsg({ text: p.error, tone: "error" });
    setLanes(r.data.map(toDraft));
    setDirty(false);
    setTried(false);
    setMsg({ text: "Saved. Nori looks again with these.", tone: "ok" });
    void noriReact({ event: "searching", say: "Looking again with these." });
    window.setTimeout(() => void noriReact({ event: "idle" }), 4000);
  }

  if (error && !lanes)
    return (
      <div className={`${CARD} items-start`}>
        <p className="font-semibold text-ink">Couldn&rsquo;t load what Nori looks for.</p>
        <p className={HINT}>{error}</p>
      </div>
    );
  if (!lanes) return <div aria-hidden="true" className="h-[420px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />;

  return (
    <>
      <div>
        <h2 className={H2}>What Nori looks for</h2>
        <p className={`${HINT} mt-1`}>Nori shortlists a job when it fits at least one lane that&rsquo;s on.</p>
      </div>

      {lanes.map((l) => (
        <section key={l.key} aria-label={`Lane: ${l.name || "unnamed"}`} className={`${CARD} ${l.enabled ? "" : "bg-surface-2"}`}>
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <Field id={`lane-name-${l.key}`} label="Lane name" value={l.name} maxLength={100} onChange={(e) => edit(l.key, { name: e.target.value })} error={tried && !l.name.trim() ? "Name the lane" : null} className="font-semibold" />
            </div>
            <div className="flex min-h-12 items-center gap-2">
              <span aria-hidden="true" className="text-small font-medium text-ink">
                {l.enabled ? "On" : "Off"}
              </span>
              <Switch on={l.enabled} onChange={(enabled) => edit(l.key, { enabled })} label={`Look for ${l.name.trim() || "this lane"}`} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
            <ChipsInput id={`lane-titles-${l.key}`} label="Job titles" values={l.titles} onChange={(titles) => edit(l.key, { titles: titles.slice(0, 20) })} placeholder="Add a job title and press Enter" />
            <div className="flex flex-col gap-1">
              <ChipsInput id={`lane-places-${l.key}`} label="Places" values={l.locations} onChange={(locations) => edit(l.key, { locations: locations.slice(0, 20) })} placeholder="Add a city or country" />
              <label className="flex min-h-11 items-center gap-2.5 text-[0.9375rem] text-ink">
                <input type="checkbox" checked={l.remote} onChange={(e) => edit(l.key, { remote: e.target.checked })} className="size-5 accent-accent" />
                Remote is fine
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`lane-fit-${l.key}`} className="text-ui font-semibold text-ink">
              Lowest fit Nori shortlists: <span className="tabular-nums">{l.fit}%</span>
            </label>
            <input id={`lane-fit-${l.key}`} type="range" min={50} max={90} step={5} value={l.fit} aria-valuetext={`${l.fit}%`} onChange={(e) => edit(l.key, { fit: Number(e.target.value) })} className="h-11 w-full accent-accent" />
            <p className={HINT}>Higher means fewer, closer matches.</p>
          </div>
          <button type="button" onClick={() => (setLanes((ls) => ls?.filter((x) => x.key !== l.key) ?? null), setDirty(true), setMsg(null))} className={`${DANGER_BUTTON} self-start`}>
            Remove this lane
          </button>
        </section>
      ))}

      {lanes.length < MAX_LANES && (
        <button
          type="button"
          onClick={() => {
            const d: Draft = { key: `k${nextKey++}`, id: null, name: "New lane", titles: [], locations: [], remote: false, fit: 70, enabled: true };
            focusKey.current = d.key;
            setLanes((ls) => [...(ls ?? []), d]);
            setDirty(true);
            setMsg(null);
          }}
          className={buttonClass("outline", "min-h-11 self-start")}
        >
          Add a lane
        </button>
      )}

      <section aria-labelledby="every-lane" className={CARD}>
        <h3 id="every-lane" className="text-[1.0625rem] font-semibold text-ink">
          Every lane
        </h3>
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <Field
            id="every-salary"
            label="Lowest salary to consider, a year"
            inputMode="numeric"
            placeholder="95,000"
            value={salary}
            hint="US dollars. Jobs that show less are left out."
            onChange={(e) => (setSalary(e.target.value), setDirty(true), setMsg(null))}
          />
          <ChipsInput id="every-skip" label="Companies to skip" values={skip} onChange={(v) => (setSkip(v), setDirty(true), setMsg(null))} placeholder="Add a company" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty && !msg && <span className={HINT}>Unsaved changes</span>}
        {msg && <Status tone={msg.tone}>{msg.text}</Status>}
      </div>
    </>
  );
}
