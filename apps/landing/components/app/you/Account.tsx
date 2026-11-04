"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/Button";
import { Field, PasswordField } from "@/components/auth/fields";
import { api, type Session, type User } from "@/lib/api";
import { checkNewPassword, checkPassword, noriReact } from "@/lib/auth-flow";
import { shortDate } from "@/lib/app-state";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { CARD, DANGER_FILL, H2, HINT, Status, TEXT_BUTTON } from "./YouTabs";

/* /you/account: email, password, devices, theme, delete and sign out (4c spec section 6). */

export function Account() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  // Every section is drawn from the first render, in boxes that keep their size as the data arrives, so nothing moves
  // (4c spec section 11). Drawn only once the data was in, the password form counted as a 0.38 shift on phones.
  useEffect(() => {
    void api.session().then((r) => r.ok && setUser(r.data.user));
  }, []);
  return (
    <>
      <Email user={user} />
      <Password />
      <Devices />
      <ThemeChoice />
      <DeleteAccount email={user?.email ?? null} onDeleted={() => router.push("/")} />
      <button
        type="button"
        onClick={async () => {
          await api.logout();
          router.push("/");
        }}
        className={buttonClass("outline", "min-h-11 self-start")}
      >
        Sign out
      </button>
    </>
  );
}

function Email({ user }: { user: User | null }) {
  const [sent, setSent] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const confirmed = !!user?.emailVerifiedAt;
  return (
    <section aria-labelledby="email-h" className={CARD}>
      <h2 id="email-h" className={H2}>
        Email
      </h2>
      <div className="flex min-h-8 flex-wrap items-center gap-2.5">
        <p className="text-[1rem] font-semibold break-all text-ink">{user?.email ?? " "}</p>
        {user && <span className={`inline-flex h-[26px] items-center rounded-full px-3 text-[0.75rem] font-medium ${confirmed ? "bg-accent-tint text-accent" : "bg-tint text-warning"}`}>{confirmed ? "Confirmed" : "Not confirmed yet"}</span>}
      </div>
      {user && !confirmed && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const r = await api.resendVerification();
              setSent(r.ok ? { text: "Sent. Check your inbox.", tone: "ok" } : { text: r.error, tone: "error" });
            }}
            className={buttonClass("outline", "min-h-11")}
          >
            Send the link again
          </button>
          {sent && <Status tone={sent.tone}>{sent.text}</Status>}
        </div>
      )}
      <p className={HINT}>Changing your email isn&rsquo;t available yet.</p>
    </section>
  );
}

function Password() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<{ current?: string | null; next?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  async function change() {
    if (busy) return;
    const e = { current: checkPassword(current), next: checkNewPassword(next) };
    setErrors(e);
    setSaid(null);
    if (e.current || e.next) return document.getElementById(e.current ? "pw-current" : "pw-new")?.focus();
    setBusy(true);
    const r = await api.changePassword(current, next);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 403) return setErrors({ current: r.error });
      return setSaid({ text: r.error, tone: "error" });
    }
    setCurrent("");
    setNext("");
    setSaid({ text: "Changed. You’re signed out everywhere else.", tone: "ok" });
    dispatchEvent(new Event("norinote:sessions"));
    void noriReact({ row: "nod", say: "Password changed." });
  }
  return (
    <form noValidate onSubmit={(e) => (e.preventDefault(), void change())} aria-labelledby="pw-h" className={CARD}>
      <h2 id="pw-h" className={H2}>
        Password
      </h2>
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <PasswordField id="pw-current" label="Current password" autoComplete="current-password" value={current} error={errors.current} onChange={(e) => (setCurrent(e.target.value), setErrors((x) => ({ ...x, current: null })))} />
        <PasswordField id="pw-new" label="New password" autoComplete="new-password" value={next} hint="Use at least 8 characters" error={errors.next} onChange={(e) => (setNext(e.target.value), setErrors((x) => ({ ...x, next: null })))} />
      </div>
      <p className={`${HINT} text-[0.875rem]`}>Changing it signs you out everywhere else.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11")}>
          {busy ? "Changing…" : "Change password"}
        </button>
        {said && <Status tone={said.tone}>{said.text}</Status>}
      </div>
    </form>
  );
}

function Devices() {
  const [list, setList] = useState<Session[] | null>(null);
  const [said, setSaid] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  useEffect(() => {
    const load = () => void api.sessions().then((r) => r.ok && setList(r.data));
    load();
    addEventListener("norinote:sessions", load);
    return () => removeEventListener("norinote:sessions", load);
  }, []);
  const others = list?.filter((s) => !s.current) ?? [];
  return (
    <section aria-labelledby="devices-h" className={`${CARD} min-h-[300px] gap-0`}>
      <h2 id="devices-h" className={`${H2} mb-1`}>
        Where you&rsquo;re signed in
      </h2>
      {!list ? (
        <div aria-hidden="true" className="h-[180px]" />
      ) : (
        <ul>
          {list.map((s) => (
            <li key={s.id} className="flex min-h-[60px] items-center gap-3 border-b-[1.5px] border-line py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{s.device}</span>
                <span className={`block ${HINT}`}>Signed in {shortDate(s.createdAt)}</span>
              </span>
              {s.current ? (
                <span className="inline-flex h-[26px] items-center rounded-full bg-tint px-3 text-[0.75rem] font-medium text-ink">This device</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Sign out of ${s.device}`}
                  onClick={async () => {
                    const r = await api.endSession(s.id);
                    if (!r.ok) return setSaid({ text: r.error, tone: "error" });
                    setList((l) => l?.filter((x) => x.id !== s.id) ?? null);
                    setSaid({ text: `Signed out of ${s.device}.`, tone: "ok" });
                  }}
                  className={TEXT_BUTTON}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-3.5 empty:hidden">
        {others.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const r = await api.endOtherSessions();
              if (!r.ok) return setSaid({ text: r.error, tone: "error" });
              setList((l) => l?.filter((x) => x.current) ?? null);
              setSaid({ text: `Signed out of ${r.data.revoked} other ${r.data.revoked === 1 ? "device" : "devices"}.`, tone: "ok" });
            }}
            className={buttonClass("outline", "min-h-11")}
          >
            Sign out everywhere else
          </button>
        )}
        {said && <Status tone={said.tone}>{said.text}</Status>}
      </div>
    </section>
  );
}

function ThemeChoice() {
  const theme = useTheme();
  return (
    <fieldset className={`${CARD} m-0`}>
      <legend className={`${H2} float-left w-full`}>Theme</legend>
      <div className="clear-both flex flex-wrap gap-2">
        {(["system", "light", "dark"] as Theme[]).map((t) => (
          <label
            key={t}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink ${theme === t ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink"}`}
          >
            <input type="radio" name="you-theme" checked={theme === t} onChange={() => setTheme(t)} className="size-4 accent-accent outline-none" />
            {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
          </label>
        ))}
      </div>
      <p className={HINT}>The same switch as the account menu. System follows your device.</p>
    </fieldset>
  );
}

function DeleteAccount({ email, onDeleted }: { email: string | null; onDeleted: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!email && typed.trim().toLowerCase() === email.toLowerCase();
  async function remove() {
    if (!ready || busy) return;
    setBusy(true);
    const r = await api.deleteAccount(typed.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDeleted();
  }
  return (
    <details className="group rounded-card border-[1.5px] border-danger bg-surface">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 font-semibold text-danger tablet:px-5 [&::-webkit-details-marker]:hidden">
        Delete your account
        <span aria-hidden="true" className="text-[1.25rem]">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
      </summary>
      <div className="flex flex-col gap-3.5 px-4 pb-4 tablet:px-5 tablet:pb-5">
        <p className="leading-[1.5] text-ink">Everything goes: your graph, applications, inbox and resumes. This can&rsquo;t be undone.</p>
        <Field id="delete-confirm" label={`Type ${email ?? "your email"} to confirm`} autoComplete="off" value={typed} error={error} onChange={(e) => (setTyped(e.target.value), setError(null))} />
        <button type="button" onClick={() => void remove()} aria-disabled={!ready || busy || undefined} className={`${DANGER_FILL} self-start aria-disabled:opacity-45`}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </details>
  );
}
