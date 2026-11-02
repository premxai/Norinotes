import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/** An error the client should see as `{ error, detail? }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503,
    message: string,
    readonly detail?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, detail?: string) => new HttpError(400, message, detail);
export const notFound = (what = "Not found") => new HttpError(404, what);

/** Reads and validates a JSON body. A missing or empty body counts as `{}`. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text.trim() !== "") {
    try { raw = JSON.parse(text); } catch { throw badRequest("Request body is not valid JSON"); }
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const res = schema.safeParse(raw);
  if (!res.success) throw badRequest("Invalid request", describeIssues(res.error));
  return res.data;
}

export function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 5).map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** A path id that is not a UUID cannot exist: 404 instead of a database error. */
export function uuidParam(c: Context, name = "id"): string {
  const v = c.req.param(name) ?? "";
  if (!isUuid(v)) throw notFound();
  return v;
}

export function intParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** One handler for every error: `{ error, detail? }`, never a stack trace or a secret. */
export function errorHandler(log: (line: string) => void) {
  return (err: Error, c: Context) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
      return c.json({ error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.status);
    }
    if (err instanceof HTTPException) return c.json({ error: err.message || "Request failed" }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", detail: describeIssues(err) }, 400);
    log(`[api] ${c.req.method} ${c.req.path} failed: ${err.name}: ${err.message}`);
    return c.json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
  };
}
