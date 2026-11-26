/**
 * Finish in the live view: while Nori hands a captcha or a sign-in page to the person, their clicks and keys reach the
 * browser through a small input bus. The API publishes each input; the worker that holds the page applies it.
 *
 * Nothing on this path is stored or logged: what the person types may be a password. Across processes the bus is
 * Postgres LISTEN/NOTIFY (a notification is delivered and gone, never written to a table); in one process (local dev,
 * tests) it is an in-memory emitter. Inputs are only applied while a hand-off for that application is open.
 */
import { createNotifyChannel } from "@norinote/db";
import type { Page } from "playwright";
import { z } from "zod";

/** Keys the live view passes on besides typed text. */
export const LIVE_KEYS = ["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Space"] as const;

/** One input from the person. Coordinates are fractions of the frame (0 to 1), so any display size maps to the page. */
export const LiveInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("type"), text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("key"), key: z.enum(LIVE_KEYS), shift: z.boolean().optional() }),
  z.object({ kind: z.literal("scroll"), dy: z.number().min(-5000).max(5000) }),
  /** The person says the step is done: Nori checks the page now instead of on its next look. */
  z.object({ kind: z.literal("done") }),
  /** The person gives up on this one: it goes back to ready_to_finish. */
  z.object({ kind: z.literal("cancel") }),
]);
export type LiveInput = z.infer<typeof LiveInput>;

export type LiveInputHandler = (input: LiveInput) => void;

export interface LiveInputBus {
  publish(applicationId: string, input: LiveInput): Promise<void>;
  /** Receive inputs for one application until the returned function is called. */
  subscribe(applicationId: string, onInput: LiveInputHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** Subscribers by application, shared by both buses. */
function registry() {
  const subs = new Map<string, Set<LiveInputHandler>>();
  return {
    add(id: string, fn: LiveInputHandler) {
      const set = subs.get(id) ?? new Set();
      set.add(fn);
      subs.set(id, set);
      return () => { set.delete(fn); if (!set.size) subs.delete(id); };
    },
    deliver(id: string, input: LiveInput) {
      for (const fn of subs.get(id) ?? []) {
        try { fn(input); } catch { /* one handler's error must not stop the others */ }
      }
    },
  };
}

export function createMemoryInputBus(): LiveInputBus {
  const reg = registry();
  return {
    async publish(id, input) { reg.deliver(id, input); },
    async subscribe(id, fn) { const off = reg.add(id, fn); return async () => off(); },
    async close() {},
  };
}

let shared: LiveInputBus | null = null;
/** The process-wide in-memory bus: the API and the worker share it when they run in one process without Postgres. */
export function sharedMemoryInputBus(): LiveInputBus {
  return (shared ??= createMemoryInputBus());
}

/**
 * Postgres LISTEN/NOTIFY, for an API and a worker on different machines. A notification that arrives while no hand-off
 * is open for its application is dropped.
 */
export function createPgInputBus(connectionString: string): LiveInputBus {
  const reg = registry();
  const channel = createNotifyChannel(connectionString, "nori_live_input");
  let listening: Promise<void> | null = null;
  return {
    async publish(id, input) {
      await channel.publish(JSON.stringify({ a: id, i: input }));
    },
    async subscribe(id, fn) {
      await (listening ??= channel.listen((payload) => {
        try {
          const { a, i } = JSON.parse(payload) as { a: unknown; i: unknown };
          const input = LiveInput.safeParse(i);
          if (typeof a === "string" && input.success) reg.deliver(a, input.data);
        } catch { /* not ours */ }
      }).catch((err) => { listening = null; throw err; }));
      const off = reg.add(id, fn);
      return async () => off();
    },
    close: () => channel.close(),
  };
}

/** The bus for this process: Postgres when there is one, else the shared in-memory bus. */
export function liveInputBusFor(databaseUrl: string | undefined): LiveInputBus {
  return databaseUrl ? createPgInputBus(databaseUrl) : sharedMemoryInputBus();
}

/** Plays one input on the page. Clicks land at the same spot of the viewport the frame showed. */
export async function applyLiveInput(page: Page, input: LiveInput): Promise<void> {
  switch (input.kind) {
    case "click": {
      const size = page.viewportSize() ?? { width: 1280, height: 900 };
      await page.mouse.click(Math.round(input.x * size.width), Math.round(input.y * size.height));
      return;
    }
    case "type":
      await page.keyboard.type(input.text);
      return;
    case "key":
      await page.keyboard.press(`${input.shift ? "Shift+" : ""}${input.key === "Space" ? " " : input.key}`);
      return;
    case "scroll":
      await page.mouse.wheel(0, input.dy);
      return;
    default:
      return;
  }
}
