/** Helpers for the browser tests: skip when Chromium is missing, and serve static fixtures from a local port. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/** True when a Chromium build is already installed. Tests never download one. */
export function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(here, "fixtures");

export type FixtureServer = { origin: string; hits: string[]; close: () => Promise<void> };

/** Serves files from src/fixtures plus any inline pages given as `{ "/path": html }`. Bound to 127.0.0.1 only. */
export async function startFixtureServer(inline: Record<string, string> = {}): Promise<FixtureServer> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    hits.push(`${req.method} ${url.pathname}`);
    void (async () => {
      const page = inline[url.pathname];
      if (page !== undefined) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
        return;
      }
      const file = path.join(FIXTURES_DIR, path.basename(url.pathname));
      try {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(file));
      } catch {
        res.writeHead(404).end("not found");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
