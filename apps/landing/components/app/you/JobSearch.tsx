"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/Button";
import { Field } from "@/components/auth/fields";
import { ChipsInput } from "@/components/onboarding/controls";
import { api, type Lane, type Profile } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { CARD, H2, HINT, Status, Switch } from "./YouTabs";

/* /settings/search (dashboard v2 plan section 8): the job search basics the Nori chat doesn't handle. Places and
   remote apply to every role (they are stored per role, so saving sets them on each); the minimum salary is the
   profile's; the skip list is THE skip list (`/api/nori/settings` skipCompanies). Roles, the daily cap and the threshold
   are set by talking to Nori. */

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

/** Every role's places, once each (ignoring case), in the order first seen. */
function unionPlaces(lanes: Lane[], fallback: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of lanes.length ? lanes.flatMap((l) => l.locations) : fallback) {
    const k = p.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p.trim());
  }
  return out;
}

type Loaded = { lanes: Lane[]; prefs: Profile["preferences"] };

export function JobSearch() {
  const [data, setData] = useState<Loaded | null>(null);
  const [places, setPlaces] = useState<string[]>([]);
  const [remote, setRemote] = useState(true);
  const [salary, setSalary] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  useEffect(() => {
    void Promise.all([api.lanes(), api.me(), api.noriSettings()]).then(([l, me, nori]) => {
      if (!l.ok) return setError(l.error);
      if (!me.ok) return setError(me.error);
      const prefs = me.data.profile.preferences;
      setData({ lanes: l.data, prefs });
      setPlaces(unionPlaces(l.data, prefs.locations ?? []));
      setRemote(l.data.length ? l.data.some((x) => x.remote) : prefs.remote !== "no");
      setSalary(prefs.salaryMin ? prefs.salaryMin.toLocaleString("en-US") : "");
      setSkip(nori.ok ? nori.data.settings.skipCompanies : (prefs.excludeCompanies ?? []));
    });
  }, []);
  useLeaveGuard(dirty);

  const edited = () => (setDirty(true), setMsg(null));

  async function save() {
    if (!data || busy) return;
    setBusy(true);
    setMsg(null);
    if (data.lanes.length) {
      const r = await api.saveLanes(data.lanes.map((l) => ({ id: l.id, name: l.name, titles: l.titles, locations: places.slice(0, 20), remote, minFit: l.minFit, enabled: l.enabled })));
      if (!r.ok) return (setBusy(false), setMsg({ text: r.error, tone: "error" }));
      setData((d) => (d ? { ...d, lanes: r.data } : d));
    }
    const min = Number(salary.replace(/[^\d.]/g, ""));
    // The API keeps no "unset" for the lowest salary; 0 lets every job through.
    const p = await api.saveProfile({
      preferences: { locations: places, remote: remote ? (data.prefs.remote === "only" ? "only" : "ok") : "no", salaryMin: min > 0 ? min : 0 },
    });
    if (!p.ok) return (setBusy(false), setMsg({ text: p.error, tone: "error" }));
    const n = await api.saveNoriSettings({ skipCompanies: skip.slice(0, 1000) });
    setBusy(false);
    if (!n.ok) return setMsg({ text: n.error, tone: "error" });
    setData((d) => (d ? { ...d, prefs: p.data.preferences } : d));
    setDirty(false);
    setMsg({ text: "Saved. Nori looks again with these.", tone: "ok" });
    void noriReact({ event: "searching", say: "Looking again with these." });
    window.setTimeout(() => void noriReact({ event: "idle" }), 4000);
  }

  if (error && !data)
    return (
      <div className={`${CARD} items-start`}>
        <p className="font-semibold text-ink">Couldn&rsquo;t load your job search.</p>
        <p className={HINT}>{error}</p>
      </div>
    );
  if (!data) return <div aria-hidden="true" className="h-[520px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />;

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-tint px-4 py-3 text-[0.9375rem] text-ink">
        Roles, the daily cap, the threshold score and the schedule are set by talking to Nori.
        <Link href="/nori" className="font-semibold text-ink underline underline-offset-[3px]">
          Open Nori
        </Link>
      </p>

      <section aria-labelledby="places-h" className={CARD}>
        <div>
          <h2 id="places-h" className={H2}>
            Places
          </h2>
          <p className={`${HINT} mt-1`}>Where you&rsquo;d work. Nori only matches jobs here{data.lanes.length > 1 ? ", for every role" : ""}.</p>
        </div>
        <ChipsInput id="search-places" label="Places" values={places} onChange={(v) => (setPlaces(v.slice(0, 20)), edited())} placeholder="Add a place and press Enter" />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[0.9375rem] font-medium text-ink">
            Remote jobs count too
          </span>
          <Switch on={remote} onChange={(v) => (setRemote(v), edited())} label="Remote jobs count too" />
        </div>
      </section>

      <section aria-labelledby="salary-h" className={CARD}>
        <div>
          <h2 id="salary-h" className={H2}>
            Salary
          </h2>
          <p className={`${HINT} mt-1`}>The least you&rsquo;d take. Jobs that list less are left out; jobs that don&rsquo;t list pay stay in.</p>
        </div>
        <div className="max-w-[320px]">
          <Field id="search-salary" label="Minimum a year (US dollars)" inputMode="numeric" placeholder="95,000" value={salary} onChange={(e) => (setSalary(e.target.value), edited())} />
        </div>
      </section>

      <section aria-labelledby="skip-h" className={CARD}>
        <div>
          <h2 id="skip-h" className={H2}>
            Companies to skip
          </h2>
          <p className={`${HINT} mt-1`}>Nori never matches or applies to these, wherever the jobs come from.</p>
        </div>
        <ChipsInput id="search-skip" label="Companies to skip" values={skip} onChange={(v) => (setSkip(v), edited())} placeholder="Add a company to skip" />
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
