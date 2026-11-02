"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, Lock, Mail } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Icon, cx } from "../ui";
import { btnPrimary, chip, field, fieldLabel, textLink } from "../home/styles";

const message = (e: unknown) => (e instanceof ApiError ? e.detail : (e as Error).message);

/** What the account-link pages share (forgot, reset, verify). The sign-in layout supplies the frame around it. */
function LinkCard({ badge, title, children }: { badge: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="text-ink">
      <p className={chip}>{badge}</p>
      <h1 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">{title}</h1>
      {children}
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-control border border-[#f3c6cf] bg-danger-tint px-3.5 py-3 text-[14px] font-medium text-danger-fg">
      <Icon icon={CircleAlert} size={18} className="mt-px shrink-0" />{children}
    </p>
  );
}

const backLink = (
  <p className="mt-8 border-t border-line pt-6 text-[14.5px] text-ink-2">
    <Link href="/login" className={textLink}>Back to sign in</Link>
  </p>
);

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.forgotPassword(email.trim()); setSent(true); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <LinkCard badge="Check your email" title={<>Link on<br />its way.</>}>
        <p role="status" className="mt-5 flex items-start gap-2 text-[15px] leading-relaxed text-ink-2">
          <Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-accent-fg" />
          <span>If an account exists for <strong className="text-ink">{email.trim()}</strong>, we have sent a link to choose a new password. It works for one hour.</span>
        </p>
        {backLink}
      </LinkCard>
    );
  }
  return (
    <LinkCard badge="Reset password" title={<>Forgot your<br />password?</>}>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-2">Enter the email you signed up with and we will send you a link to choose a new one.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <label className="block">
          <span className={fieldLabel}>Email</span>
          <span className="relative block">
            <Icon icon={Mail} size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input className={field} type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} required />
          </span>
        </label>
        {error && <ErrorLine>{error}</ErrorLine>}
        <button type="submit" disabled={busy || !email.trim()} className={cx(btnPrimary, "w-full")}>
          {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Sending</> : <>Send reset link<Icon icon={ArrowRight} /></>}
        </button>
      </form>
      {backLink}
    </LinkCard>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <LinkCard badge="Reset password" title={<>That link is<br />incomplete.</>}>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">Open the link from the email exactly as it was sent, or ask for a new one.</p>
        <p className="mt-6"><Link href="/forgot-password" className={textLink}>Send a new link</Link></p>
        {backLink}
      </LinkCard>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) { setError("The two passwords do not match."); return; }
    setBusy(true); setError(null);
    try { await api.resetPassword(token!, password); setDone(true); setTimeout(() => router.replace("/login"), 2500); }
    catch (err) { setError(message(err)); setBusy(false); }
  }

  if (done) {
    return (
      <LinkCard badge="Password changed" title={<>All set.</>}>
        <p role="status" className="mt-5 flex items-start gap-2 text-[15px] leading-relaxed text-ink-2">
          <Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-accent-fg" />
          <span>Your password is updated and every device was signed out. Taking you to sign in.</span>
        </p>
        <p className="mt-6"><Link href="/login" className={textLink}>Sign in now</Link></p>
      </LinkCard>
    );
  }
  return (
    <LinkCard badge="Reset password" title={<>Choose a<br />new password.</>}>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {[["New password", password, setPassword, "new-password"], ["Repeat it", again, setAgain, "new-password"]].map(([label, value, set, ac], i) => (
          <label key={label as string} className="block">
            <span className={fieldLabel}>{label as string}</span>
            <span className="relative block">
              <Icon icon={Lock} size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input className={field} type="password" value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} autoComplete={ac as string} minLength={8} required />
            </span>
            {i === 0 && <span className="mt-1.5 block text-[13px] text-muted">At least 8 characters.</span>}
          </label>
        ))}
        {error && <ErrorLine>{error}</ErrorLine>}
        <button type="submit" disabled={busy} className={cx(btnPrimary, "w-full")}>
          {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Saving</> : <>Set new password<Icon icon={ArrowRight} /></>}
        </button>
      </form>
      {error && /expired|invalid/i.test(error) && <p className="mt-4 text-meta"><Link href="/forgot-password" className={textLink}>Send a new link</Link></p>}
      {backLink}
    </LinkCard>
  );
}

/** Spends the confirmation token once on arrival (a ref guards React's double effect). */
export function VerifyEmailStatus({ token }: { token?: string }) {
  const [state, setState] = useState<"working" | "ok" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This confirmation link is incomplete.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.verifyEmail(token).then(() => setState("ok")).catch((err) => { setError(message(err)); setState("failed"); });
  }, [token]);

  return (
    <LinkCard badge="Email" title={state === "ok" ? <>You are<br />confirmed.</> : state === "working" ? <>Confirming<br />your email.</> : <>We could not<br />confirm that.</>}>
      {state === "working" && <p role="status" className="mt-5 flex items-center gap-2 text-[15px] leading-relaxed text-ink-2"><Icon icon={LoaderCircle} className="animate-spin" />One moment.</p>}
      {state === "ok" && (
        <>
          <p role="status" className="mt-5 flex items-start gap-2 text-[15px] leading-relaxed text-ink-2"><Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-accent-fg" />Your email address is confirmed.</p>
          <p className="mt-6"><Link href="/dashboard" className={btnPrimary}>Continue to Norinote<Icon icon={ArrowRight} /></Link></p>
        </>
      )}
      {state === "failed" && (
        <>
          {error && <ErrorLine>{error}</ErrorLine>}
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">Sign in and open <strong className="text-ink">Settings</strong> to get a new link.</p>
          <p className="mt-4"><Link href="/settings" className={textLink}>Go to Settings</Link></p>
        </>
      )}
    </LinkCard>
  );
}
