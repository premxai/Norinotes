"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { carried, checkEmail, checkNewPassword, noriReact } from "@/lib/auth-flow";
import { SwitchLink } from "./AuthFrame";
import { AuthHeading, Field, FormError, PasswordField, PlanChip, StatusLine, SubmitButton, useDesktopAutofocus } from "./fields";
import { useAuthForm, useQueryParam, useSignedInRedirect } from "./useAuthForm";

/** /signup (auth spec sections 9 and 14): email and password, then onboarding. */
export function SignUpForm() {
  const router = useRouter();
  const form = useAuthForm();
  const [email, setEmail] = useState(carried.email);
  const [password, setPassword] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const pro = useQueryParam("plan") === "pro" || carried.plan === "pro";
  useDesktopAutofocus(emailRef);
  useSignedInRedirect();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.phase !== "idle") return;
    if (!form.check([["email", checkEmail(email), emailRef], ["password", checkNewPassword(password), passwordRef]])) return;
    form.start();
    const r = await api.signup(email.trim(), password);
    if (!r.ok) {
      // The API's wording ends in "Sign in instead."; here that's a link.
      if (r.status === 409) return form.fail({ text: "An account with this email already exists.", link: { href: "/signin", label: "Sign in instead" } }, 409);
      return form.fail({ text: r.error }, r.status);
    }
    carried.email = email.trim();
    if (pro) carried.plan = "pro";
    form.succeed();
    await noriReact({ event: "welcome" });
    router.push("/onboarding");
  }

  return (
    <div className="flex flex-col gap-6 laptop:gap-8">
      <AuthHeading title="Create your account" lead="Then add your resume, and Nori builds your first shortlist." />
      {pro && <PlanChip />}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 laptop:gap-5">
        <Field
          id="signup-email"
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
          id="signup-password"
          label="Password"
          name="password"
          autoComplete="new-password"
          inputRef={passwordRef}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            form.edited("password");
          }}
          error={form.errors.password}
          hint="At least 8 characters"
        />
        <div className="mt-1 flex flex-col gap-3">
          {form.failure && <FormError link={form.failure.link}>{form.failure.text}</FormError>}
          <SubmitButton busy={form.busy} label="Create account" busyLabel="Creating your account…" />
          <StatusLine done={form.phase === "done"} text={form.busy ? "Creating your account…" : form.phase === "done" ? "Account created. Opening onboarding…" : ""} />
        </div>
      </form>
      <div className="-mt-2 flex flex-col gap-1">
        <p className="text-small text-ink-2">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="text-ink underline decoration-1 underline-offset-[3px]">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-ink underline decoration-1 underline-offset-[3px]">
            Privacy
          </Link>
          .
        </p>
        <SwitchLink className="text-center tablet:hidden" />
      </div>
    </div>
  );
}
