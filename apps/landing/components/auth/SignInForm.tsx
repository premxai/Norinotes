"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { carried, checkEmail, checkPassword, noriReact, safeNext, signedInHome } from "@/lib/auth-flow";
import { SwitchLink } from "./AuthFrame";
import { AuthHeading, Field, FormError, PasswordField, StatusLine, SubmitButton, useDesktopAutofocus } from "./fields";
import { useAuthForm, useSignedInRedirect } from "./useAuthForm";

/** /signin (auth spec sections 9 and 14): then the dashboard, or onboarding if it isn't finished. */
export function SignInForm() {
  const router = useRouter();
  const form = useAuthForm();
  const [email, setEmail] = useState(carried.email);
  const [password, setPassword] = useState("");
  const [home, setHome] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useDesktopAutofocus(emailRef);
  useSignedInRedirect();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.phase !== "idle") return;
    if (!form.check([["email", checkEmail(email), emailRef], ["password", checkPassword(password), passwordRef]])) return;
    form.start();
    const r = await api.login(email.trim(), password);
    if (!r.ok) return form.fail({ text: r.error }, r.status);
    carried.email = email.trim();
    const reacted = noriReact({ event: "signed-in", say: "Welcome back!" });
    const next = await signedInHome(safeNext(new URLSearchParams(location.search).get("next")));
    setHome(next);
    form.succeed();
    await reacted;
    router.push(next);
  }

  return (
    <div className="flex flex-col gap-6 laptop:gap-8">
      <AuthHeading title="Welcome back" lead="Sign in to see today's shortlist." />
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 laptop:gap-5">
        <Field
          id="signin-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          data-nori-watch="text"
          inputRef={emailRef}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            carried.email = e.target.value;
            form.edited("email");
          }}
          error={form.errors.email}
        />
        <PasswordField
          id="signin-password"
          label="Password"
          name="password"
          autoComplete="current-password"
          inputRef={passwordRef}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            form.edited("password");
          }}
          error={form.errors.password}
          aside={
            <Link href="/forgot-password" className="py-1 text-small font-medium text-ink underline decoration-1 underline-offset-[3px] hover:decoration-accent">
              Forgot password?
            </Link>
          }
        />
        <div className="mt-1 flex flex-col gap-3">
          {form.failure && <FormError link={form.failure.link}>{form.failure.text}</FormError>}
          <SubmitButton busy={form.busy} label="Sign in" busyLabel="Signing in…" />
          <StatusLine done={form.phase === "done"} text={form.busy ? "Signing in…" : form.phase === "done" ? `Signed in. Opening ${home === "/onboarding" ? "onboarding" : home === "/dashboard" ? "today's shortlist" : "your page"}…` : ""} />
        </div>
      </form>
      <SwitchLink className="-mt-2 text-center tablet:hidden" />
    </div>
  );
}
