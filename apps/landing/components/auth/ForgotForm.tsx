"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { carried, checkEmail, noriReact } from "@/lib/auth-flow";
import { SwitchLink } from "./AuthFrame";
import { AuthHeading, Field, FormError, ResultPanel, StatusLine, SubmitButton, useDesktopAutofocus } from "./fields";
import { useAuthForm } from "./useAuthForm";

/** /forgot-password: the API answers the same for every address, so the panel can't say whether an account exists. */
export function ForgotForm() {
  const form = useAuthForm();
  const [email, setEmail] = useState(carried.email);
  const emailRef = useRef<HTMLInputElement>(null);
  useDesktopAutofocus(emailRef);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.phase !== "idle") return;
    if (!form.check([["email", checkEmail(email), emailRef]])) return;
    form.start();
    const r = await api.forgot(email.trim());
    if (!r.ok) return form.fail({ text: r.error }, r.status);
    carried.email = email.trim();
    form.succeed();
    void noriReact({ event: "email-sent", say: "Check your inbox." });
  }

  if (form.phase === "done")
    return (
      <ResultPanel
        title="Check your inbox"
        body={`If there's an account for ${email.trim()}, a reset link is on its way. It works for one hour.`}
        action={{ label: "Back to sign in", href: "/signin" }}
      />
    );

  return (
    <div className="flex flex-col gap-6 laptop:gap-8">
      <AuthHeading title="Reset your password" lead="We'll email you a link. It works for one hour." />
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 laptop:gap-5">
        <Field
          id="forgot-email"
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
        <div className="mt-1 flex flex-col gap-3">
          {form.failure && <FormError link={form.failure.link}>{form.failure.text}</FormError>}
          <SubmitButton busy={form.busy} label="Send link" busyLabel="Sending…" />
          <StatusLine text={form.busy ? "Sending…" : ""} />
        </div>
      </form>
      <SwitchLink className="-mt-2 text-center tablet:hidden" />
    </div>
  );
}
