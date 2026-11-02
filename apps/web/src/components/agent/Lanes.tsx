"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Lane } from "@/lib/types";
import { ChipInput } from "../ChipInput";
import { Button, cx, Field, Icon, inputClass, Switch, Tag } from "../ui";

function LaneEditor({ lane, isNew, onSave, onCancel, onDelete }: { lane: Lane; isNew: boolean; onSave: (l: Lane) => void; onCancel: () => void; onDelete: () => void }) {
  const [d, setD] = useState(lane);
  const set = <K extends keyof Lane>(k: K, v: Lane[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...d, name: d.name.trim() || "Untitled lane" }); }}
      className="grid gap-x-5 gap-y-4 md:grid-cols-2"
    >
      <Field label="Name"><input className={inputClass} value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus={isNew} placeholder="Frontend, remote" /></Field>
      <label className="flex items-end gap-2 pb-2 text-body-sm text-ink">
        <input type="checkbox" className="h-4 w-4" checked={d.remote} onChange={(e) => set("remote", e.target.checked)} />
        Include remote jobs
      </label>
      <div>
        <span className="mb-1.5 block text-meta font-medium text-ink-2">Titles</span>
        <ChipInput label="Titles" value={d.titles} onChange={(v) => set("titles", v)} placeholder="Senior Frontend Engineer" />
      </div>
      <div>
        <span className="mb-1.5 block text-meta font-medium text-ink-2">Places</span>
        <ChipInput label="Places" value={d.locations} onChange={(v) => set("locations", v)} placeholder="Anywhere" />
      </div>
      <Field label={<>Minimum fit <span className="text-ink tnum">{pct(d.minFit)}%</span></>} hint="Jobs that fit you less than this never reach your shortlist.">
        <input className="mt-2 w-full" type="range" min={0} max={100} step={5} value={pct(d.minFit)} onChange={(e) => set("minFit", Number(e.target.value) / 100)} />
      </Field>
      <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-2">
        {!isNew && <Button variant="danger" icon={Trash2} onClick={onDelete} className="mr-auto">Delete lane</Button>}
        <Button variant="secondary" icon={X} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon={Check} type="submit">Save lane</Button>
      </div>
    </form>
  );
}

/** Lanes: each one is a kind of job you want. The shortlist only draws from enabled lanes. */
export function LanesFrame({ initial }: { initial: Lane[] }) {
  const [lanes, setLanes] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<Lane | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: Lane[]) {
    const prev = lanes;
    setLanes(next);
    setError(null);
    try {
      setLanes(await api.saveLanes(next));
    } catch (e) {
      setLanes(prev);
      setError((e as Error).message);
    }
  }

  function startAdd() {
    setEditing(null);
    setAdding({ id: `new-${Date.now().toString(36)}`, name: "", titles: [], locations: [], remote: true, minFit: 0.6, enabled: true });
  }

  const all = adding ? [...lanes, adding] : lanes;

  return (
    <section aria-labelledby="lanes-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="lanes-h" className="text-body-sm font-semibold text-ink">Your lanes</h3>
        <Button variant="secondary" size="sm" icon={Plus} onClick={startAdd} disabled={!!adding}>Add a lane</Button>
      </div>
      {all.length === 0 && (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-body-sm text-muted">No lanes yet. Your shortlist stays empty until Norinote knows what you want.</p>
      )}
      <ul className="flex flex-col gap-2.5">
        {all.map((l) => {
          const isNew = adding?.id === l.id;
          const open = isNew || editing === l.id;
          return (
            <li key={l.id} className={cx("rounded-card border bg-surface p-4", open ? "border-ink" : "border-line")}>
              {open ? (
                <LaneEditor
                  lane={l}
                  isNew={isNew}
                  onCancel={() => (isNew ? setAdding(null) : setEditing(null))}
                  onDelete={() => { setEditing(null); void persist(lanes.filter((x) => x.id !== l.id)); }}
                  onSave={(next) => {
                    if (isNew) { setAdding(null); void persist([...lanes, next]); }
                    else { setEditing(null); void persist(lanes.map((x) => (x.id === next.id ? next : x))); }
                  }}
                />
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-3">
                    <Switch checked={l.enabled} label={`${l.name} lane ${l.enabled ? "on" : "off"}`} onChange={(v) => void persist(lanes.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)))} />
                    <div className="min-w-0 flex-1">
                      <p className={cx("text-body-sm font-semibold", l.enabled ? "text-ink" : "text-muted")}>{l.name}</p>
                      <p className="mt-0.5 text-meta text-muted tnum">{l.remote ? "Remote included" : "On-site only"} · minimum fit {pct(l.minFit)}%{l.enabled ? "" : " · off"}</p>
                    </div>
                    <button type="button" aria-label={`Edit ${l.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => { setAdding(null); setEditing(l.id); }}>
                      <Icon icon={Pencil} size={14} /> Edit
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
                    {l.titles.length === 0 ? <span className="text-meta text-muted">Any title</span> : l.titles.map((t) => <Tag key={t}>{t}</Tag>)}
                    <span className="mx-1 text-meta text-muted">in</span>
                    {l.locations.length === 0 ? <span className="text-meta text-muted">anywhere</span> : l.locations.map((t) => <Tag key={t}>{t}</Tag>)}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-meta text-danger-fg" role="alert">{error}</p>}
    </section>
  );
}
