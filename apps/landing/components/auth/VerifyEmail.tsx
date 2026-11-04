"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { noriReact, signedInHome } from "@/lib/auth-flow";
import { ResultPanel } from "./fields";
import { useLinkToken } from "./useAuthForm";

type Answer = { kind: "ok"; next: string } | { kind: "expired" } | { kind: "failed"; error: string };

/** /verify-email?token=…: confirms the address as soon as the page opens, signed in or not. */
export function VerifyEmail() {
  const token = useLinkToken();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void noriReact({ event: "loading" });
    void api.verify(token).then(async (r) => {
      if (!live) return;
      if (r.ok) {
        // Signed in: on to onboarding or the dashboard. Otherwise sign in first.
        const next = (await api.session()).ok ? await signedInHome() : "/signin";
        if (!live) return;
        setAnswer({ kind: "ok", next });
        void noriReact({ row: "celebrate" });
      } else if (r.status === 400) {
        setAnswer({ kind: "expired" });
        void noriReact({ row: "deflated" }).then(() => noriReact({ row: "comfort" }));
      } else {
        setAnswer({ kind: "failed", error: r.error });
        void noriReact({ event: "auth-failed", say: r.status === 0 ? "I can't reach Norinote." : "Something went wrong." });
      }
    });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  if (token === null || answer?.kind === "expired")
    return (
      <ResultPanel
        title="This link has expired"
        body="Confirmation links last 3 days. Sign in, and Nori can send you a new one."
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  if (answer?.kind === "ok") return <ResultPanel title="Email confirmed" body="Thanks. You're all set." action={{ label: "Continue", href: answer.next }} />;
  if (answer?.kind === "failed")
    return (
      <ResultPanel
        title="Couldn't check the link"
        body={answer.error}
        action={{
          label: "Try again",
          onClick: () => {
            setAnswer(null);
            setAttempt((n) => n + 1);
          },
        }}
      />
    );

  // While checking: a quiet line; Nori sways.
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-auth text-ink">Confirming your email</h1>
      <p aria-live="polite" className="text-lead text-ink-2">
        One moment…
      </p>
    </div>
  );
}
