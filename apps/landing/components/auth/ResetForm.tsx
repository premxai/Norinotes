"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { checkNewPassword, noriReact } from "@/lib/auth-flow";
import { SwitchLink } from "./AuthFrame";
import { AuthHeading, FormError, PasswordField, ResultPanel, StatusLine, SubmitButton, useDesktopAutofocus } from "./fields";
import { useAuthForm, useLinkToken } from "./useAuthForm";

const EXPIRED = { text: "This reset link is invalid or has expired.", link: { href: "/forgot-password", label: "Ask for a new one" } };

/** /reset-password?token=…: a new password. The API signs out every session, so it ends at sign-in. */
export function ResetForm() {
  const form = useAuthForm();
  const token = useLinkToken();
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  useDesktopAutofocus(passwordRef);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.phase !== "idle" || !token) return;
    if (!form.check([["password", checkNewPassword(password), passwordRef]])) return;
    form.start();
    const r = await api.reset(token, password);
    if (!r.ok) return form.fail(r.status === 400 ? EXPIRED : { text: r.error }, r.status);
    form.succeed();
    // signed-in (a nod, then a wave) ends the key loop that saving started; a bare nod would hand back to it.
    void noriReact({ event: "signed-in", say: "Password saved." });
  }

  if (token === null)
    return (
      <ResultPanel
        title="This link has expired"
        body="Reset links work for one hour, once. Ask for a new one and use the newest email."
        action={{ label: "Send a new link", href: "/forgot-password" }}
      />
    );

  if (form.phase === "done")
    return <ResultPanel title="Password changed" body="You're signed out on every device. Sign in with your new password." action={{ label: "Sign in", href: "/signin" }} />;

  return (
    <div className="flex flex-col gap-6 laptop:gap-8">
      <AuthHeading title="Choose a new password" lead="You'll sign in with it next." />
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 laptop:gap-5">
        <PasswordField
          id="reset-password"
          label="New password"
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
          <SubmitButton busy={form.busy} label="Save password" busyLabel="Saving…" />
          <StatusLine text={form.busy ? "Saving…" : ""} />
        </div>
      </form>
      <SwitchLink className="-mt-2 text-center tablet:hidden" />
    </div>
  );
}
