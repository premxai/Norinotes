"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, Mail, UserRound, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { btnPrimary, chip, field, fieldLabel, textLink } from "@/components/home/styles";
import { cx } from "@/components/cx";

/** Only same-site paths are honoured as a post-login destination. */
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard");

function Field({ id, label, icon: Icon, hint, children }: { id: string; label: string; icon: LucideIcon; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>{label}</label>
      <div className="relative">
        <Icon size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        {children}
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

/** The sign-up form (/signup) and the sign-in form (/login). */
export function AuthPanel({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (signup) await api.signup(email.trim(), password, name.trim());
      else await api.login(email.trim(), password);
      router.replace(signup ? "/onboarding" : safeNext(next));
      router.refresh();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401 ? "That email and password do not match."
          : status === 409 ? "An account with that email already exists. Try signing in instead."
          : status === 429 ? "Too many attempts. Wait a few minutes and try again."
          : err instanceof ApiError ? err.detail : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <p className={chip}>{signup ? "Create account" : "Sign in"}</p>
      <h1 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">
        {signup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
        {signup
          ? "It takes about a minute. Next, Norinote reads your resume, and nothing is sent anywhere until you click."
          : "Sign in to see your shortlist."}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        {signup && (
          <Field id="auth-name" label="Full name" icon={UserRound}>
            <input id="auth-name" className={field} placeholder="Maya Chen" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} required />
          </Field>
        )}
        <Field id="auth-email" label="Email" icon={Mail}>
          <input id="auth-email" className={field} type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} required />
        </Field>
        <Field id="auth-password" label="Password" icon={Lock} hint={signup ? "At least 8 characters." : undefined}>
          <input
            id="auth-password"
            className={cx(field, "pr-14")}
            type={show ? "text" : "password"}
            placeholder={signup ? "Create a password" : "Your password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 8 : undefined}
            aria-describedby={signup ? "auth-password-hint" : undefined}
            required
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </Field>

        {!signup && (
          <p className="-mt-2 text-right text-[14px]">
            <Link href="/forgot-password" className={textLink}>Forgot password?</Link>
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-control border border-[#f3c6cf] bg-danger-tint px-3.5 py-3 text-[14px] font-medium text-danger-fg">
            <CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0" />{error}
          </p>
        )}

        <button type="submit" disabled={busy} className={cx(btnPrimary, "w-full")}>
          {busy
            ? <><LoaderCircle size={18} aria-hidden="true" className="animate-spin" />{signup ? "Creating account" : "Signing in"}</>
            : <>{signup ? "Create account" : "Sign in"}<ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </form>

      {signup && (
        <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
          By creating an account you agree to the <Link href="/terms" className={textLink}>Terms</Link> and the <Link href="/privacy" className={textLink}>Privacy page</Link>.
        </p>
      )}
      <p className="mt-8 border-t border-line pt-6 text-[14.5px] text-ink-2">
        {signup ? "Already have an account? " : "New to Norinote? "}
        <Link href={signup ? "/login" : "/signup"} className={textLink}>{signup ? "Sign in" : "Create an account"}</Link>
      </p>
    </div>
  );
}
