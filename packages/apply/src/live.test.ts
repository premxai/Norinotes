import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { FileStore } from "@norinote/shared/files";
import { createLiveFrameSink, liveFrameKey, startLiveFrames } from "./live.js";
import { createBrowserPool } from "./pool.js";
import { chromiumInstalled } from "./test-helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("live frames", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "norinote-live-")); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("keys a frame under the owner's applications folder", () => {
    expect(liveFrameKey("user-1", "app-1")).toBe("applications/user-1/live/app-1.jpg");
  });

  it("captures on a timer, one at a time, and once more when stopped", async () => {
    let shots = 0;
    const page = { isClosed: () => false, screenshot: async () => { shots++; await sleep(5); return Buffer.from(`frame-${shots}`); } } as unknown as Page;
    const frames: string[] = [];
    const stop = startLiveFrames(page, async (jpeg) => { frames.push(Buffer.from(jpeg).toString()); }, 250);
    await sleep(600);
    await stop();
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames.at(-1)).toBe(`frame-${shots}`);
    const before = frames.length;
    await sleep(300);
    expect(frames.length).toBe(before);
  });

  it("ignores capture errors and keeps going", async () => {
    let n = 0;
    const page = { isClosed: () => false, screenshot: async () => { n++; if (n === 1) throw new Error("navigating"); return Buffer.from("ok"); } } as unknown as Page;
    const frames: number[] = [];
    const stop = startLiveFrames(page, async () => { frames.push(n); }, 250);
    await sleep(400);
    await stop();
    expect(frames.length).toBeGreaterThan(0);
  });

  it("writes the frame to disk and storage, and removes both after the keep time", async () => {
    const stored = new Map<string, Uint8Array>();
    const store: FileStore = {
      put: async (key, body) => { stored.set(key, body); },
      get: async (key) => stored.get(key) ?? null,
      deletePrefix: async (prefix) => { let n = 0; for (const k of [...stored.keys()]) if (k.startsWith(prefix)) { stored.delete(k); n++; } return n; },
    };
    const sink = createLiveFrameSink({ root: dir, store, keepMs: 150 });
    await sink({ applicationId: "app-9", userId: "user-9", jpeg: Buffer.from("jpeg-bytes") });
    const key = liveFrameKey("user-9", "app-9");
    expect(readFileSync(path.join(dir, key), "utf8")).toBe("jpeg-bytes");
    expect(Buffer.from(stored.get(key)!).toString()).toBe("jpeg-bytes");
    expect(sink.pending()).toBe(1);
    await sleep(300);
    expect(existsSync(path.join(dir, key))).toBe(false);
    expect(stored.has(key)).toBe(false);
    expect(sink.pending()).toBe(0);
  });
});

describe.skipIf(!chromiumInstalled())("live frames from a real page", () => {
  it("captures JPEG frames of what the browser shows", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "norinote-live-real-"));
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    try {
      const frames: Uint8Array[] = [];
      await pool.run("live", async (page) => {
        await page.setContent("<h1>Applying to Acme</h1><input value='Ada Lovelace'>");
        const stop = startLiveFrames(page, async (jpeg) => { frames.push(jpeg); }, 250);
        await sleep(600);
        await stop();
      });
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect([frames[0]![0], frames[0]![1]]).toEqual([0xff, 0xd8]);
    } finally {
      await pool.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("live frames never break a run", () => {
  it("does nothing harmful on a page it cannot capture", async () => {
    const stop = startLiveFrames({} as Page, async () => { throw new Error("should not be called"); }, 250);
    await sleep(300);
    await expect(stop()).resolves.toBeUndefined();
  });
});
