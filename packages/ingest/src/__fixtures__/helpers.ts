import { vi } from "vitest";

/** A JSON response. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * A mocked fetch that answers by URL prefix (first match wins; longer prefixes should be listed first). Anything
 * unmatched is a 404, so a test never reaches the network. Use as the `fetch` option of connectors and pollBoard.
 */
export function routeFetch(handlers: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, handler] of Object.entries(handlers)) if (url.startsWith(prefix)) return handler(url, init);
    return new Response("not found", { status: 404 });
  }) as ReturnType<typeof vi.fn> & typeof fetch;
}

/** Instant retries: no sleeping in tests. */
export const noSleep = { sleep: async () => {}, random: () => 0 };

/** Resolves every host to a public address, so the SSRF check needs no DNS. */
export const publicLookup = async () => ["93.184.216.34"];
