import type { Db } from "@norinote/db";
import { forwardMessage, type Forwarder, type ForwardResult } from "./forward.js";
import type { InboxModel } from "./model.js";
import { reprocessMessage } from "./receive.js";

export type InboxJobResult =
  | { stored: false; reason: string }
  | { kind: string; linked: boolean; wake: "code" | "outcome" | null; outcome: string | null; forwarded: ForwardResult["reason"] | "sent" | null };

/**
 * The `inbox.receive` job: settle an ambiguous classification with the model, relink, record the outcome, wake waiters
 * (in-process at once; other processes on their next poll) and forward to the user's own mailbox when they asked for it.
 * Idempotent. The worker's consumer is one call to this.
 */
export async function handleInboxReceive(db: Db, messageId: string, deps: { model?: InboxModel; forwarder?: Forwarder } = {}): Promise<InboxJobResult> {
  const r = await reprocessMessage(db, messageId, deps.model ? { model: deps.model } : {});
  if (!r.stored) return { stored: false, reason: r.reason };
  let forwarded: ForwardResult["reason"] | "sent" | null = null;
  if (deps.forwarder) {
    const f = await forwardMessage(db, messageId, deps.forwarder);
    forwarded = f.forwarded ? "sent" : f.reason ?? null;
  }
  return { kind: r.kind, linked: r.applicationId !== null, wake: r.wake?.reason ?? null, outcome: r.outcome, forwarded };
}
