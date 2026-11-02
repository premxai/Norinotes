"use client";

import { useState, type ComponentType } from "react";
import { api, ApiError } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { AuthorizationStep, ContactStep, PreferencesStep, ScreeningStep, type StepProps } from "./onboarding/steps";
import { Accordion, Notice } from "./ui";

const SECTIONS: { id: string; title: string; Form: ComponentType<StepProps> }[] = [
  { id: "contact", title: "Contact", Form: ContactStep },
  { id: "authorization", title: "Work authorization", Form: AuthorizationStep },
  { id: "screening", title: "Screening answers", Form: ScreeningStep },
  { id: "preferences", title: "Job preferences", Form: PreferencesStep },
];

/** The onboarding answers, editable after the fact. Each section saves through PUT /api/profile. */
export function AnswersEditor({ profile: initial }: { profile: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; tone: "green" | "red"; text: string } | null>(null);

  async function save(id: string, data: Record<string, unknown>) {
    setBusy(id);
    setNote(null);
    try {
      const saved = await api.updateProfile(data as Parameters<typeof api.updateProfile>[0]);
      setProfile((p) => ({ ...p, ...data, ...(saved ?? {}) }) as Profile);
      setNote({ id, tone: "green", text: "Saved." });
    } catch (e) {
      setNote({ id, tone: "red", text: e instanceof ApiError ? e.detail : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {SECTIONS.map(({ id, title, Form }, i) => (
        <Accordion key={id} title={title} defaultOpen={i === 0}>
          <div className="pt-1">
            <Form
              profile={profile}
              busy={busy === id}
              submitLabel="Save"
              onSubmit={(d) => save(id, d)}
              status={note?.id === id ? <Notice tone={note.tone}>{note.text}</Notice> : undefined}
            />
          </div>
        </Accordion>
      ))}
    </div>
  );
}
