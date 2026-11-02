"use client";

import { Check, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { USE_MOCK, api, ApiError } from "@/lib/api";
import type { Profile, TelegramInfo, TelegramLink } from "@/lib/types";
import { Button, Field, Frame, IndexLabel, Notice, Pill, TextLink, inputClass } from "./ui";

/** The one shared daily cap: how many applications Norinote may send by itself each day. 0 means only when you click. */
export function SettingsForm({ profile }: { profile: Profile }) {
  const [cap, setCap] = useState(profile.autoApplyDailyCap);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api.updateProfile({ autoApplyDailyCap: cap });
      setNote({ tone: "green", text: "Settings saved." });
    } catch (e) {
      setNote({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame className="p-5 sm:p-6">
      <Field label="Daily cap for sending on its own" hint="0 means Norinote only applies when you click.">
        <input className={`${inputClass} max-w-40 tnum`} type="number" min={0} max={100} value={cap} onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))} />
      </Field>
      {cap > 0 && (
        <div className="mt-5"><Notice tone="amber">With a cap above 0, Norinote may send up to {cap} application{cap === 1 ? "" : "s"} a day without asking, using the same checks as your own click.</Notice></div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Button variant="primary" icon={Check} onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        {note && <div className="min-w-0 flex-1"><Notice tone={note.tone}>{note.text}</Notice></div>}
      </div>
    </Frame>
  );
}

/** Telegram: link a chat so Norinote can message you when something needs a click. */
export function Channels({ telegram: initial }: { telegram: TelegramInfo | null }) {
  const [telegram, setTelegram] = useState(initial);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [busy, setBusy] = useState<"link" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const tgLinked = telegram?.linked ?? false;
  const bot = link?.botUsername ?? telegram?.botUsername ?? null;
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.detail : (e as Error).message);

  async function getCode() {
    setBusy("link"); setError(null); setNote(null);
    try { setLink(await api.telegramLink()); } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function check() {
    setBusy("check"); setError(null);
    try {
      const next = await api.telegramInfo();
      setTelegram(next);
      setNote(next.linked ? "Linked. Notifications now reach your phone." : "Not linked yet. Send the code to the bot, then check again.");
      if (next.linked) setLink(null);
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  return (
    <Frame className="p-5 text-body-sm">
      <div className="flex items-center justify-between gap-3">
        <IndexLabel tone="ink">Telegram{bot ? <span className="ml-2 font-normal text-muted">@{bot}</span> : null}</IndexLabel>
        {tgLinked ? <Pill mark="ink">Linked</Pill> : <Pill mark="hollow">Not linked</Pill>}
      </div>
      {telegram && !telegram.configured ? (
        <p className="mt-4 text-meta text-ink-2">Telegram is not switched on for this Norinote yet.</p>
      ) : tgLinked ? (
        <p className="mt-4 text-meta text-ink-2">Your phone is linked. Norinote messages you when an application is ready or needs an answer.</p>
      ) : (
        <>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-meta text-ink-2">
            <li>Press Link Telegram to get a one-time code.</li>
            <li>{bot ? `Open @${bot} in Telegram and send the code.` : "Open the Norinote bot in Telegram and send the code."}</li>
            <li>Press Check. This page shows Linked once it worked.</li>
          </ol>
          {link && (
            <div className="mt-4 rounded-card bg-sunken p-4" role="status">
              <div className="text-label font-medium uppercase text-muted">Your code, valid 15 minutes</div>
              <div className="mt-1 font-mono text-[26px] font-semibold tracking-[0.3em] text-ink">{link.code}</div>
              {link.link && <div className="mt-2"><TextLink href={link.link} external>Open @{link.botUsername} with the code filled in</TextLink></div>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button icon={Link2} onClick={getCode} disabled={busy !== null}>{busy === "link" ? "Getting a code..." : link ? "New code" : "Link Telegram"}</Button>
            <Button variant="secondary" icon={RefreshCw} onClick={check} disabled={busy !== null}>{busy === "check" ? "Checking..." : "Check"}</Button>
          </div>
        </>
      )}
      {note && <p className="mt-3 text-meta text-ink-2" role="status">{note}</p>}
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Frame>
  );
}

/** Irreversible: deletes the account and everything keyed on it. The button stays disabled until the email is typed exactly. */
export function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockNote, setMockNote] = useState(false);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(typed.trim());
      if (USE_MOCK) { setMockNote(true); setBusy(false); return; }
      router.replace("/signup");
      router.refresh();
    } catch (e) {
      setError((e as { detail?: string }).detail ?? (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Frame className="p-5 sm:p-6">
      <p className="text-body-sm text-ink-2">
        Deleting your account permanently removes your career graph, resumes, applications, inbox and linked Telegram chat. This cannot be undone.
      </p>
      <div className="mt-5 max-w-md">
        <Field label="Type your email to confirm" hint={email}>
          <input
            className={inputClass}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            placeholder={email}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Button
          icon={Trash2}
          onClick={remove}
          disabled={!matches || busy}
          className="border-[#a8321f]! text-[#a8321f]! hover:bg-[#a8321f]! hover:text-on-ink!"
        >
          {busy ? "Deleting..." : "Delete account"}
        </Button>
        {error && <div className="min-w-0 flex-1"><Notice tone="red">{error}</Notice></div>}
        {mockNote && <div className="min-w-0 flex-1"><Notice tone="amber">Demo mode: nothing was deleted.</Notice></div>}
      </div>
    </Frame>
  );
}
