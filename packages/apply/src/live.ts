/**
 * "Watch Nori apply": while a run is on the employer's page, a small JPEG of what the browser shows is taken about once
 * a second and kept as one file per application (overwritten each time), on this disk and in object storage, so the API
 * on another machine can serve the latest one to the application's owner. The file is removed a while after the last
 * frame; it sits in the owner's applications folder, which account deletion removes.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { userApplicationsDir, type FileStore } from "@norinote/shared/files";

/** Storage key (and path under the artifacts root) of an application's latest live frame. */
export const liveFrameKey = (userId: string, applicationId: string): string =>
  `${userApplicationsDir(userId)}/live/${applicationId.replace(/[^a-zA-Z0-9-]+/g, "_")}.jpg`;

export type LiveFrame = { applicationId: string; userId: string; jpeg: Uint8Array };
/** Receives each frame; must not throw (a failed frame is skipped, the run goes on). */
export type LiveFrameSink = (frame: LiveFrame) => Promise<void>;

/**
 * Takes a viewport JPEG every `everyMs` until the returned stop is called, which also takes one last frame. One capture
 * at a time: a slow page skips ticks instead of piling them up. Capture errors are ignored.
 */
export function startLiveFrames(page: Page, onFrame: (jpeg: Uint8Array) => Promise<void>, everyMs = 1000): () => Promise<void> {
  let busy = false;
  let stopped = false;
  // Never throws: a frame is a nice-to-have and must not be able to break the run it watches.
  const capture = async () => {
    if (busy) return;
    busy = true;
    try {
      if (page.isClosed()) return;
      const jpeg = await page.screenshot({ type: "jpeg", quality: 55, animations: "disabled", caret: "initial", timeout: 3000 });
      await onFrame(jpeg);
    } catch {
      // A navigation, a closed page, or no page to capture: the next tick tries again.
    } finally {
      busy = false;
    }
  };
  void capture();
  const timer = setInterval(() => { if (!stopped) void capture(); }, Math.max(250, everyMs));
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (let i = 0; i < 20 && busy; i++) await new Promise((r) => setTimeout(r, 50));
    await capture();
  };
}

/**
 * The worker's sink: writes the frame under `root` and copies it to `store` (when set), and removes both `keepMs` after
 * the last frame of that application (default 15 minutes).
 */
export function createLiveFrameSink(opts: { root: string; store: FileStore | null; keepMs?: number; log?: (line: string) => void }): LiveFrameSink & { pending: () => number } {
  const timers = new Map<string, NodeJS.Timeout>();
  const keepMs = opts.keepMs ?? 15 * 60_000;
  const sink = async ({ applicationId, userId, jpeg }: LiveFrame) => {
    const key = liveFrameKey(userId, applicationId);
    const file = path.join(opts.root, key);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, jpeg);
      if (opts.store) await opts.store.put(key, jpeg, "image/jpeg");
    } catch (err) {
      opts.log?.(`[apply] live frame not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timers.get(key));
    const t = setTimeout(() => {
      timers.delete(key);
      void rm(file, { force: true }).catch(() => undefined);
      if (opts.store) void opts.store.deletePrefix(key).catch(() => undefined);
    }, keepMs);
    t.unref?.();
    timers.set(key, t);
  };
  return Object.assign(sink, { pending: () => timers.size });
}
