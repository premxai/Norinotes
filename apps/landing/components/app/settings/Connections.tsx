"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/Button";
import { api, type GmailState, type TelegramState } from "@/lib/api";
import { CARD, DANGER_BUTTON, H2, HINT, Status, TEXT_BUTTON } from "../you/YouTabs";
import { Telegram } from "../you/NoriSettings";

/* /settings/connections (dashboard v2 plan section 8): Gmail for emailed codes, and Telegram for questions and news. */

export function Connections() {
  const [gmail, setGmail] = useState<GmailState | string | null>(null);
  const [telegram, setTelegram] = useState<TelegramState | string | null>(null);
  useEffect(() => {
    void Promise.all([api.gmail(), api.telegram()]).then(([g, t]) => {
      setGmail(g.ok ? g.data : g.error);
      setTelegram(t.ok ? t.data : t.error);
    });
  }, []);
  if (gmail === null || telegram === null) return <div aria-hidden="true" className="h-[420px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />;
  return (
    <>
      <Gmail initial={gmail} />
      <Telegram initial={telegram} />
    </>
  );
}

function Gmail({ initial }: { initial: GmailState | string }) {
  const [g, setG] = useState<GmailState | null>(typeof initial === "string" ? null : initial);
  const error = typeof initial === "string" ? initial : null;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const r = await api.connectGmail();
    if (!r.ok) {
      setBusy(false);
      return setMsg({ text: r.error, tone: "error" });
    }
    location.assign(r.data.url);
  }
  async function disconnect() {
    if (busy) return;
    setBusy(true);
    const r = await api.disconnectGmail();
    setBusy(false);
    setAsking(false);
    if (!r.ok) return setMsg({ text: r.error, tone: "error" });
    setG((x) => (x ? { ...x, connected: false, status: null } : x));
    setMsg({ text: "Gmail disconnected. Nori no longer reads it.", tone: "ok" });
  }

  return (
    <section aria-labelledby="gmail-h" className={CARD}>
      <h2 id="gmail-h" className={H2}>
        Gmail, for emailed codes
      </h2>
      {error && !g ? (
        <p className={HINT}>{error}</p>
      ) : g && !g.available ? (
        <p className="text-[0.9375rem] text-ink-2">Gmail can&rsquo;t be connected here yet. You can still type a code when an application asks for one.</p>
      ) : (
        g && (
          <>
            <p className="font-semibold text-ink">
              {g.connected ? (
                <span className="inline-flex items-center gap-2 text-accent">
                  <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                  Connected
                </span>
              ) : g.status === "EXPIRED" ? (
                "The connection expired. Connect it again so codes keep arriving."
              ) : (
                "Not connected"
              )}
            </p>
            <p className="max-w-[62ch] leading-[1.5] text-ink-2">
              Read-only. Only while an application is waiting for a verification code, Nori checks for code emails that arrived since the wait began, and enters the code. It doesn&rsquo;t look at other times.
            </p>
            {g.connected ? (
              asking ? (
                <div role="alertdialog" aria-labelledby="gmail-ask" className="flex flex-wrap items-center gap-2.5 rounded-[12px] bg-tint p-3">
                  <p id="gmail-ask" className="flex-[1_1_220px] font-semibold text-ink">
                    Disconnect Gmail? You&rsquo;ll type each code yourself.
                  </p>
                  <button type="button" onClick={() => void disconnect()} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11")}>
                    {busy ? "Disconnecting…" : "Yes, disconnect"}
                  </button>
                  <button type="button" onClick={() => setAsking(false)} className={TEXT_BUTTON}>
                    Keep it
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => (setAsking(true), setMsg(null))} className={`${DANGER_BUTTON} self-start`}>
                  Disconnect
                </button>
              )
            ) : (
              <button type="button" onClick={() => void connect()} aria-disabled={busy || undefined} className={buttonClass("primary", "min-h-11 self-start")}>
                {busy ? "Opening Google…" : "Connect Gmail"}
              </button>
            )}
          </>
        )
      )}
      {msg && <Status tone={msg.tone}>{msg.text}</Status>}
    </section>
  );
}
