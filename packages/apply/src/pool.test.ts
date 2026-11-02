import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserPool, PoolRunError } from "./pool.js";
import { chromiumInstalled, startFixtureServer, type FixtureServer } from "./test-helpers.js";

const run = chromiumInstalled();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!run)("browser pool (real Chromium)", () => {
  let dir: string;
  let server: FixtureServer;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "norinote-pool-"));
    server = await startFixtureServer({ "/hello": "<html><body><h1 id=h>Hello</h1></body></html>" });
  });
  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("clamps the size to 1..4 and defaults to 3", () => {
    expect(createBrowserPool({ artifactsDir: dir }).stats().size).toBe(3);
    expect(createBrowserPool({ size: 9, artifactsDir: dir }).stats().size).toBe(4);
    expect(createBrowserPool({ size: 0, artifactsDir: dir }).stats().size).toBe(1);
  });

  it("keeps one warm browser, never exceeds its size, and queues the rest", async () => {
    const pool = createBrowserPool({ size: 2, artifactsDir: dir });
    try {
      await pool.warmUp();
      expect(pool.stats()).toMatchObject({ browserLaunched: true, launches: 1 });
      let active = 0;
      let max = 0;
      let sawWaiting = 0;
      const jobs = Array.from({ length: 5 }, (_, i) => pool.run(`job-${i}`, async (page) => {
        active++;
        max = Math.max(max, active);
        sawWaiting = Math.max(sawWaiting, pool.stats().waiting);
        await page.goto(`${server.origin}/hello`);
        await sleep(150);
        active--;
        return i;
      }));
      const results = await Promise.all(jobs);
      expect(results.map((r) => r.value)).toEqual([0, 1, 2, 3, 4]);
      expect(max).toBe(2);
      expect(sawWaiting).toBeGreaterThan(0);
      expect(pool.stats()).toMatchObject({ active: 0, waiting: 0, launches: 1 });
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("gives every run a fresh context: nothing stored by one run is visible to the next", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    try {
      await pool.run("one", async (page) => {
        await page.goto(`${server.origin}/hello`);
        await page.evaluate("localStorage.setItem('k', 'v')");
        await page.context().addCookies([{ name: "c", value: "1", url: server.origin }]);
      });
      const seen = await pool.run("two", async (page) => {
        await page.goto(`${server.origin}/hello`);
        return { ls: await page.evaluate("localStorage.getItem('k')"), cookies: (await page.context().cookies()).length };
      });
      expect(seen.value).toEqual({ ls: null, cookies: 0 });
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("saves a screenshot and a trace when the run throws", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    try {
      const err = await pool.run("boom", async (page) => {
        await page.goto(`${server.origin}/hello`);
        throw new Error("driver exploded");
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PoolRunError);
      const e = err as PoolRunError;
      expect(e.message).toBe("driver exploded");
      expect(e.timedOut).toBe(false);
      expect(e.artifacts.screenshotPath && existsSync(e.artifacts.screenshotPath)).toBe(true);
      expect(e.artifacts.tracePath && existsSync(e.artifacts.tracePath)).toBe(true);
      expect(e.artifacts.screenshotPath).toContain(dir);
      expect(pool.stats().active).toBe(0); // the slot is released
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("saves artifacts on request even when the run returns normally", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    try {
      const quiet = await pool.run("quiet", async (page) => { await page.goto(`${server.origin}/hello`); return 1; });
      expect(quiet.artifacts).toEqual({});
      const kept = await pool.run("kept", async (page, handle) => { await page.goto(`${server.origin}/hello`); handle.keepArtifacts(); return 2; });
      expect(kept.value).toBe(2);
      expect(kept.artifacts.screenshotPath && existsSync(kept.artifacts.screenshotPath)).toBe(true);
      expect(kept.artifacts.tracePath && existsSync(kept.artifacts.tracePath)).toBe(true);
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("times a run out, frees its slot, and lets the next run proceed", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir, timeoutMs: 600 });
    try {
      const err = await pool.run("hang", async (page) => {
        await page.goto(`${server.origin}/hello`);
        await new Promise(() => {}); // never settles
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PoolRunError);
      expect((err as PoolRunError).timedOut).toBe(true);
      expect((err as PoolRunError).message).toMatch(/timed out after 600 ms/);
      const next = await pool.run("after", async () => "ok");
      expect(next.value).toBe("ok");
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("relaunches the browser if it died", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    try {
      await pool.run("kill", async (page) => { await page.context().browser()?.close(); }).catch(() => {});
      const r = await pool.run("again", async (page) => { await page.goto(`${server.origin}/hello`); return page.title(); });
      expect(r.value).toBe("");
      expect(pool.stats().launches).toBe(2);
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("rejects runs after close", async () => {
    const pool = createBrowserPool({ size: 1, artifactsDir: dir });
    await pool.close();
    await expect(pool.run("late", async () => 1)).rejects.toThrow(/closed/);
  });
});

describe.skipIf(run)("browser pool without Chromium", () => {
  it.skip("skipped: Chromium is not installed (run `npx playwright install chromium`)", () => {});
});
