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

export const FORMS_DIR = path.join(FIXTURES_DIR, "forms");

export type FormFixture = { id: string; ats: "greenhouse" | "lever" | "ashby"; company: string; jobId: string; url: string; title: string };

/** The saved application pages (see scripts/eval/apply-fixtures.mts), from forms/manifest.json. */
export async function formFixtures(): Promise<FormFixture[]> {
  try {
    return JSON.parse(await readFile(path.join(FORMS_DIR, "manifest.json"), "utf8")) as FormFixture[];
  } catch {
    return [];
  }
}

/** Options the replay shim offers for each combobox, from the Greenhouse questions JSON saved next to the page. */
export function comboOptionsFromGreenhouse(json: unknown): Record<string, string[] | boolean> {
  const out: Record<string, string[] | boolean> = {};
  const j = (json ?? {}) as { questions?: { fields: { name: string; type: string; values?: { label: string }[] }[] }[]; compliance?: { questions?: { fields: { name: string; type: string; values?: { label: string }[] }[] }[] }[] | null; demographic_questions?: { questions?: { id: number; type: string; answer_options?: { label: string }[] }[] } };
  for (const q of [...(j.questions ?? []), ...(j.compliance ?? []).flatMap((c) => c.questions ?? [])]) for (const f of q.fields) {
    if (f.values?.length) out[f.name] = f.values.map((v) => v.label);
    if (f.type === "multi_value_multi_select") out[`__multi__${f.name}`] = true;
  }
  for (const d of j.demographic_questions?.questions ?? []) {
    out[String(d.id)] = (d.answer_options ?? []).map((a) => a.label);
    if (d.type === "multi_value_multi_select") out[`__multi__${d.id}`] = true;
  }
  return out;
}

export type FormServer = FixtureServer & { submits: number };

/**
 * Serves the saved forms on 127.0.0.1 with the replay shim injected (comboboxes, yes/no buttons, file chips, stubbed
 * submit). `/forms/<id>.html`, `/forms/css/*`, `POST /__submit` (counted, never forwarded anywhere).
 */
export async function startFormServer(): Promise<FormServer> {
  const hits: string[] = [];
  const state = { submits: 0 };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    hits.push(`${req.method} ${url.pathname}`);
    void (async () => {
      try {
        if (url.pathname === "/__submit") { state.submits++; res.writeHead(200, { "content-type": "application/json" }).end("{\"ok\":true}"); return; }
        if (url.pathname === "/__shim.js") { res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(path.join(FORMS_DIR, "shim.js"))); return; }
        const m = /^\/forms\/(css\/)?([\w.-]+)$/.exec(url.pathname);
        if (!m) { res.writeHead(404).end("not found"); return; }
        if (m[1]) { res.writeHead(200, { "content-type": "text/css" }).end(await readFile(path.join(FORMS_DIR, "css", m[2]!))); return; }
        const id = m[2]!.replace(/\.html$/, "");
        let html = await readFile(path.join(FORMS_DIR, `${id}.html`), "utf8");
        let options: Record<string, string[] | boolean> = {};
        try { options = comboOptionsFromGreenhouse(JSON.parse(await readFile(path.join(FORMS_DIR, `${id}.gh.json`), "utf8"))); } catch { /* not Greenhouse */ }
        const inject = `<script>window.__fixtureOptions=${JSON.stringify(options).replace(/</g, "\u003c")};</script><script src="/__shim.js"></script>`;
        html = html.includes("</body>") ? html.replace("</body>", `${inject}</body>`) : html + inject;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
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
    get submits() { return state.submits; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
