"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, LogOut, MailCheck, MonitorSmartphone } from "lucide-react";
import { ApiError, USE_MOCK, api } from "@/lib/api";
import type { SessionInfo, User } from "@/lib/types";
import { Button, Field, Frame, Notice, Pill, inputClass } from "./ui";

const errorText = (e: unknown) => (e instanceof ApiError ? e.detail : (e as Error).message);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function EmailStatus({ user }: { user: User }) {
  const [verified] = useState(Boolean(user.emailVerifiedAt));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function resend() {
    setBusy(true); setNote(null);
    try {
      const r = await api.resendVerification();
      setNote({ tone: "green", text: r.verified ? "Your email is already confirmed." : `We sent a new link to ${user.email}.` });
    } catch (e) { setNote({ tone: "red", text: errorText(e) }); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-body-sm text-ink">{user.email}</p>
        <p className="mt-0.5 text-meta text-muted">{verified ? "Confirmed. Account links reach you at this address." : "Not confirmed yet. Confirming lets you recover the account if you forget your password."}</p>
      </div>
      {verified ? <Pill mark="accent">Confirmed</Pill> : <Button type="button" variant="secondary" icon={MailCheck} disabled={busy} onClick={resend}>{busy ? "Sending..." : "Send confirmation link"}</Button>}
      {note && <div className="w-full"><Notice tone={note.tone}>{note.text}</Notice></div>}
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) { setNote({ tone: "red", text: "The two new passwords do not match." }); return; }
    setBusy(true); setNote(null);
    try {
      await api.changePassword(current, next);
      setCurrent(""); setNext(""); setAgain("");
      setNote({ tone: "green", text: "Password changed. Your other devices were signed out." });
    } catch (e2) { setNote({ tone: "red", text: errorText(e2) }); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4">
      <Field label="Current password"><input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
      <Field label="New password" hint="At least 8 characters."><input className={inputClass} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
      <Field label="Repeat the new password"><input className={inputClass} type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" icon={KeyRound} disabled={busy || !current || !next || !again}>{busy ? "Saving..." : "Change password"}</Button>
        {note && <div className="min-w-0 flex-1"><Notice tone={note.tone}>{note.text}</Notice></div>}
      </div>
    </form>
  );
}

function Sessions() {
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.sessions().then((l) => { if (alive) setList(l); }).catch((e) => { if (alive) { setError(errorText(e)); setList([]); } });
    return () => { alive = false; };
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { await fn(); setList(await api.sessions()); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }

  return (
    <div>
      {error && <div className="mb-4"><Notice tone="red">{error}</Notice></div>}
      {list === null ? <p className="text-meta text-muted">Loading...</p> : (
        <ul aria-label="Signed-in devices" className="divide-y divide-line border-y border-line">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <MonitorSmartphone size={18} aria-hidden="true" className="shrink-0 text-muted" />
                <div className="min-w-0">
                  <p className="text-body-sm text-ink">{s.device}{s.current && <span className="ml-2"><Pill mark="ink">This device</Pill></span>}</p>
                  <p className="text-meta text-muted">Signed in {when(s.createdAt)}</p>
                </div>
              </div>
              {!s.current && (
                <Button type="button" variant="secondary" icon={LogOut} disabled={busy !== null} aria-label={`Sign out ${s.device}`} onClick={() => void run(s.id, () => api.revokeSession(s.id))}>
                  {busy === s.id ? "Signing out..." : "Sign out"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list && list.some((s) => !s.current) && (
        <div className="mt-4">
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void run("others", () => api.revokeOtherSessions())}>
            {busy === "others" ? "Signing out..." : "Sign out all other devices"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SecurityPanel({ user }: { user: User }) {
  if (USE_MOCK) return <Frame className="p-5 sm:p-6"><p className="text-body-sm text-muted">Password and device controls need the live API (demo mode has no real account).</p></Frame>;
  return (
    <div className="space-y-6">
      <Frame className="p-5 sm:p-6"><h3 className="mb-4 text-meta font-medium text-muted">Email</h3><EmailStatus user={user} /></Frame>
      <Frame className="p-5 sm:p-6"><h3 className="mb-4 text-meta font-medium text-muted">Password</h3><ChangePassword /></Frame>
      <Frame className="p-5 sm:p-6"><h3 className="mb-4 text-meta font-medium text-muted">Signed-in devices</h3><Sessions /></Frame>
    </div>
  );
}
