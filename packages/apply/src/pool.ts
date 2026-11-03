import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

/** Sent with every page request: the project's polite identifier, appended to the browser's own user agent. */
export const POLITE_UA_SUFFIX = "NorinoteJobAgent/1.0 (+https://norinote.xyz)";

/** Requests a form never needs. Captcha scripts are never blocked (a blocked captcha would only fail the application). */
const BLOCKED_TYPES = new Set(["image", "font", "media"]);
const ANALYTICS = /google-analytics\.com|googletagmanager\.com|doubleclick\.net|segment\.(io|com)|hotjar|fullstory|mixpanel|amplitude|browser-intake-datadoghq|datadoghq-browser|intercom|facebook\.(net|com)\/tr|connect\.facebook|linkedin\.com\/(px|li)|snap\.licdn|recruitics|clarity\.ms|sentry\.io|bat\.bing|quantserve|tiktok|onetrust|cookielaw/i;

/** Route handler for a context: block images, fonts, media and analytics; everything else passes. */
export async function blockHeavy(route: Route): Promise<void> {
  const r = route.request();
  if (BLOCKED_TYPES.has(r.resourceType()) || ANALYTICS.test(r.url())) return route.abort().catch(() => {});
  return route.continue().catch(() => {});
}

export type PoolArtifacts = { screenshotPath?: string; tracePath?: string };

/** Handed to the function a run executes, next to the page. */
export interface RunHandle {
  readonly context: BrowserContext;
  /** Save a screenshot and the Playwright trace when this run ends, even though the function returned normally. */
  keepArtifacts(): void;
  /** Save a full-page screenshot now into the artifacts dir; returns its path. */
  screenshot(tag: string): Promise<string | undefined>;
}

export type PoolRunResult<T> = { value: T; artifacts: PoolArtifacts };

/** The run threw or timed out. Screenshot and trace (when they could be taken) are on `artifacts`. */
export class PoolRunError extends Error {
  readonly artifacts: PoolArtifacts;
  readonly timedOut: boolean;
  constructor(message: string, artifacts: PoolArtifacts, timedOut: boolean, cause: unknown) {
    super(message, { cause });
    this.name = timedOut ? "PoolTimeoutError" : "PoolRunError";
    this.artifacts = artifacts;
    this.timedOut = timedOut;
  }
}

export type BrowserPoolOptions = {
  /** Parallel pages. Clamped to 1..4; default 3. */
  size?: number;
  headless?: boolean;
  /** Where failure screenshots and traces go. Default: a `norinote-artifacts` folder in the OS temp dir. */
  artifactsDir?: string;
  /** Per-run limit in ms (default 180 000). Applies to the function, not to the wait in the queue. */
  timeoutMs?: number;
  viewport?: { width: number; height: number };
  /** Test seam: how to launch the browser. */
  launch?: () => Promise<Browser>;
  /** Block images, fonts, media and analytics (default true). */
  blockResources?: boolean;
  /** Keep this many fresh contexts ready so a run does not wait for one (default 1; 0 turns it off). */
  spareContexts?: number;
};

export type PoolStats = { size: number; active: number; waiting: number; browserLaunched: boolean; launches: number };

export interface BrowserPool {
  /** Run `fn` with a page from a fresh context. Waits in a queue when all slots are busy. */
  run<T>(label: string, fn: (page: Page, run: RunHandle) => Promise<T>, opts?: { timeoutMs?: number }): Promise<PoolRunResult<T>>;
  /** Launch the browser now so the first run does not pay for it. */
  warmUp(): Promise<void>;
  stats(): PoolStats;
  /** Reject waiting runs, let active ones finish their cleanup, close the browser. */
  close(): Promise<void>;
  readonly artifactsDir: string;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "run";

/**
 * One warm Chromium shared by up to `size` concurrent runs. Each run gets a fresh browser context (so cookies and storage
 * never leak between applications), closed afterwards. If the browser dies it is relaunched on the next run.
 */
export function createBrowserPool(options: BrowserPoolOptions = {}): BrowserPool {
  const size = Math.min(4, Math.max(1, Math.floor(options.size ?? 3)));
  const headless = options.headless ?? true;
  const artifactsDir = options.artifactsDir ?? path.join(os.tmpdir(), "norinote-artifacts");
  const defaultTimeout = options.timeoutMs ?? 180_000;
  const viewport = options.viewport ?? { width: 1280, height: 900 };
  const launch = options.launch ?? (() => chromium.launch({ headless }));
  const blockResources = options.blockResources ?? true;
  const spareTarget = Math.max(0, Math.min(2, options.spareContexts ?? 1));
  let userAgent: string | null = null;
  const spares: Promise<BrowserContext>[] = [];

  /** A fresh, never-used context with the polite user agent and the resource filter installed. */
  async function newContext(browser: Browser): Promise<BrowserContext> {
    if (!userAgent) {
      const probe = await browser.newContext();
      const p = await probe.newPage();
      const real = String(await p.evaluate("navigator.userAgent").catch(() => ""));
      await probe.close().catch(() => {});
      userAgent = real ? `${real} ${POLITE_UA_SUFFIX}` : POLITE_UA_SUFFIX;
    }
    const ctx = await browser.newContext({ viewport, userAgent });
    if (blockResources) await ctx.route("**/*", blockHeavy);
    return ctx;
  }
  function refillSpares(browser: Browser): void {
    while (!closed && spares.length < spareTarget) {
      const p = newContext(browser);
      p.catch(() => {});
      spares.push(p);
    }
  }
  /** A spare context when one is ready (never reused: each is handed out once), else a new one. */
  async function takeContext(browser: Browser): Promise<BrowserContext> {
    const spare = spares.shift();
    refillSpares(browser);
    if (spare) {
      const ctx = await spare.catch(() => null);
      if (ctx && ctx.browser()?.isConnected()) return ctx;
    }
    return newContext(browser);
  }

  let browserPromise: Promise<Browser> | null = null;
  let launches = 0;
  let active = 0;
  let closed = false;
  const waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

  function ensureBrowser(): Promise<Browser> {
    if (!browserPromise) {
      launches++;
      const p = launch().then((b) => {
        b.on("disconnected", () => {
          if (browserPromise === p) browserPromise = null;
        });
        return b;
      });
      p.catch(() => {
        if (browserPromise === p) browserPromise = null;
      });
      browserPromise = p;
    }
    return browserPromise;
  }

  function acquire(): Promise<void> {
    if (closed) return Promise.reject(new Error("Browser pool is closed"));
    if (active < size) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  }

  function release(): void {
    const next = waiters.shift();
    if (next) next.resolve(); // the slot passes straight to the next waiter
    else active--;
  }

  async function takeScreenshot(page: Page | undefined, label: string, tag: string): Promise<string | undefined> {
    if (!page || page.isClosed()) return undefined;
    try {
      await mkdir(artifactsDir, { recursive: true });
      const file = path.join(artifactsDir, `${safe(label)}-${tag}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true, timeout: 8000 });
      return file;
    } catch {
      return undefined;
    }
  }

  async function run<T>(label: string, fn: (page: Page, run: RunHandle) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<PoolRunResult<T>> {
    await acquire();
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let tracing = false;
    let keep = false;
    const artifacts: PoolArtifacts = {};

    const saveArtifacts = async (): Promise<void> => {
      artifacts.screenshotPath ??= await takeScreenshot(page, label, "failure");
      if (context && tracing) {
        tracing = false;
        try {
          await mkdir(artifactsDir, { recursive: true });
          const file = path.join(artifactsDir, `${safe(label)}-trace-${Date.now()}.zip`);
          await context.tracing.stop({ path: file });
          artifacts.tracePath = file;
        } catch {
          // The trace is a debugging aid; losing it must not hide the real error.
        }
      }
    };

    try {
      const browser = await ensureBrowser();
      context = await takeContext(browser);
      try {
        // DOM snapshots, no screenshots: a trace that is cheap enough to record on every run.
        await context.tracing.start({ screenshots: false, snapshots: true });
        tracing = true;
      } catch {
        tracing = false;
      }
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const ctx = context;
      const pg = page;
      const handle: RunHandle = {
        context: ctx,
        keepArtifacts: () => { keep = true; },
        screenshot: (tag) => takeScreenshot(pg, label, tag),
      };

      const timeoutMs = opts.timeoutMs ?? defaultTimeout;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = fn(pg, handle);
      work.catch(() => {}); // after a timeout the work rejects when its context closes; nobody is waiting for that
      let timedOut = false;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new Error(`Run timed out after ${timeoutMs} ms`)); }, timeoutMs);
        timer.unref?.();
      });
      try {
        const value = await Promise.race([work, timeout]);
        if (keep) await saveArtifacts();
        return { value, artifacts };
      } catch (err) {
        await saveArtifacts();
        throw new PoolRunError(err instanceof Error ? err.message : String(err), artifacts, timedOut, err);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof PoolRunError) throw err;
      // Launch or context creation failed before the function ran.
      throw new PoolRunError(err instanceof Error ? err.message : String(err), artifacts, false, err);
    } finally {
      if (context) {
        if (tracing) await context.tracing.stop().catch(() => {});
        await context.close().catch(() => {});
      }
      release();
    }
  }

  return {
    artifactsDir,
    run,
    async warmUp() {
      refillSpares(await ensureBrowser());
      await Promise.all(spares.map((p) => p.catch(() => null)));
    },
    stats: () => ({ size, active, waiting: waiters.length, browserLaunched: browserPromise !== null, launches }),
    async close() {
      closed = true;
      for (const w of waiters.splice(0)) w.reject(new Error("Browser pool is closed"));
      for (const sp of spares.splice(0)) void sp.then((c) => c.close()).catch(() => {});
      const p = browserPromise;
      browserPromise = null;
      if (p) await (await p.catch(() => null))?.close().catch(() => {});
    },
  };
}
