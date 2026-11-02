import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

/**
 * One shared headless Chromium for PDF rendering, launched on first use (0.3 to 1 s) and closed after a minute without
 * work. A caller that already has a browser (the apply worker's pool, say) passes it in instead.
 */
let browserP: Promise<Browser> | null = null;
let active = 0;
let idle: NodeJS.Timeout | null = null;
const IDLE_MS = 60_000;

function launch(): Promise<Browser> {
  const p = chromium.launch({ headless: true }).then((b) => {
    b.on("disconnected", () => { if (browserP === p) browserP = null; });
    return b;
  });
  p.catch(() => { if (browserP === p) browserP = null; });
  return p;
}

/** Run `fn` on a fresh page in its own context. Uses `browser` when given, otherwise the lazily launched shared one. */
export async function withPage<T>(fn: (page: Page) => Promise<T>, browser?: Browser): Promise<T> {
  const run = async (b: Browser): Promise<T> => {
    const ctx = await b.newContext();
    try {
      return await fn(await ctx.newPage());
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  if (browser) return run(browser);
  if (idle) { clearTimeout(idle); idle = null; }
  active++;
  try {
    return await run(await (browserP ??= launch()));
  } finally {
    if (--active === 0) {
      idle = setTimeout(() => { const p = browserP; browserP = null; p?.then((b) => b.close()).catch(() => {}); }, IDLE_MS);
      idle.unref?.();
    }
  }
}

/** Close the shared browser now (tests and shutdown). */
export async function closeSharedBrowser(): Promise<void> {
  if (idle) { clearTimeout(idle); idle = null; }
  const p = browserP; browserP = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

/** True when a Chromium build is installed for Playwright (used to skip the real-PDF smoke test). */
export function chromiumInstalled(): boolean {
  try { return existsSync(chromium.executablePath()); } catch { return false; }
}
