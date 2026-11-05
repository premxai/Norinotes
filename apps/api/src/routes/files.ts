import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { and, applications, eq, resumes, runEvents, sql, type Db } from "@norinote/db";
import { storageKey, userApplicationsDir, type FileStore } from "@norinote/shared/files";
import { requireUser } from "../auth/session.js";
import { notFound } from "../http.js";
import { toResume } from "../serialize.js";
import type { AppEnv, Ctx } from "../types.js";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf", ".zip": "application/zip",
};

/** `target` is `root` itself or inside it. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Where a recorded path points: an absolute path as it is, a relative one ("artifacts/x.png" or "x.png") under `root`. */
export function recordedTarget(root: string, p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p.replace(/^.*artifacts[\\/]/, ""));
}

/** Every file recorded on this user's applications: receipt screenshots and traces, resume PDFs. */
export async function recordedFiles(db: Db, userId: string): Promise<string[]> {
  const receipts = await db.select({ shot: sql<string | null>`${applications.receipt}->>'screenshotPath'`, trace: sql<string | null>`${applications.receipt}->>'tracePath'` })
    .from(applications).where(eq(applications.userId, userId));
  const pdfs = await db.select({ p: resumes.pdfPath }).from(resumes).innerJoin(applications, eq(applications.id, resumes.applicationId)).where(eq(applications.userId, userId));
  return [...receipts.flatMap((x) => [x.shot, x.trace]), ...pdfs.map((x) => x.p)].filter((p): p is string => !!p);
}

/**
 * The account's files, read before its rows are deleted: what receipts and run logs point at, inside `root` only.
 * Files from before screenshots were kept per user sit at the top of `root`, so they are found this way.
 */
export async function accountFiles(db: Db, userId: string, root: string): Promise<string[]> {
  const logged = await db.select({ shot: sql<string | null>`${runEvents.data}->>'screenshotPath'`, trace: sql<string | null>`${runEvents.data}->>'tracePath'` })
    .from(runEvents).innerJoin(applications, eq(applications.id, runEvents.applicationId)).where(eq(applications.userId, userId));
  const all = [...(await recordedFiles(db, userId)), ...logged.flatMap((x) => [x.shot, x.trace]).filter((p): p is string => !!p)];
  return [...new Set(all.map((p) => recordedTarget(root, p)))].filter((f) => isInside(root, f));
}

/**
 * Removes an account's files from this disk and from object storage: the ones listed, and the user's resume and
 * application folders. Best effort, each one on its own: a failure is logged and the rest still go.
 */
export async function deleteAccountFiles(ctx: Pick<Ctx, "config" | "files" | "log">, userId: string, files: string[]): Promise<void> {
  const root = ctx.config.artifactsDir;
  const fail = (what: string) => (err: unknown) => ctx.log(`[api] could not delete ${what}: ${err instanceof Error ? err.message : String(err)}`);
  const folders = [`resumes/${userId}`, userApplicationsDir(userId)];
  for (const f of files) await rm(f, { force: true }).catch(fail("a file"));
  for (const d of folders) await rm(path.join(root, d), { recursive: true, force: true }).catch(fail("a folder"));
  if (!ctx.files) return;
  // Keys are timestamped file names, so a file's own key as a prefix matches only that file.
  for (const key of files.map((f) => storageKey(f, root)).filter((k): k is string => !!k)) await ctx.files.deletePrefix(key).catch(fail("a stored file"));
  for (const d of folders) await ctx.files.deletePrefix(`${d}/`).catch(fail("stored files"));
}

/**
 * Sends a file under `root` as the response: from this machine's disk, or else from object storage (the worker that
 * made it runs elsewhere). 404 when neither has it.
 */
async function sendFile(file: string, inline: boolean, name: string, root: string, store: FileStore | null): Promise<Response> {
  const headers = (size: number) => ({
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "private, no-store",
  });
  const info = await stat(file).catch(() => null);
  if (info?.isFile()) return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, { headers: headers(info.size) });
  const key = store ? storageKey(file, root) : null;
  const body = key ? await store!.get(key) : null;
  if (!body) throw notFound("File not found");
  return new Response(body, { headers: headers(body.byteLength) });
}

export function resumeRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  /** `:file` is `<id>` for the JSON and `<id>.pdf` for the document. */
  r.get("/:file", auth, async (c) => {
    const file = c.req.param("file");
    const pdf = file.endsWith(".pdf");
    const id = pdf ? file.slice(0, -4) : file;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Resume not found");
    const [row] = await db.select({ resume: resumes }).from(resumes)
      .innerJoin(applications, eq(applications.id, resumes.applicationId))
      .where(and(eq(resumes.id, id), eq(applications.userId, c.get("user").id))).limit(1);
    if (!row) throw notFound("Resume not found");
    if (!pdf) return c.json(toResume(row.resume));
    const stored = row.resume.pdfPath;
    if (!stored) throw notFound("This resume has no PDF yet");
    const target = path.resolve(stored);
    if (!isInside(ctx.config.artifactsDir, target)) throw notFound("Resume not found");
    return sendFile(target, true, "resume.pdf", ctx.config.artifactsDir, ctx.files);
  });

  return r;
}

export function artifactRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const root = ctx.config.artifactsDir;
  const PREFIX = "/api/artifacts/";

  r.get("/*", auth, async (c) => {
    const raw = c.req.path.startsWith(PREFIX) ? c.req.path.slice(PREFIX.length) : "";
    let rel: string;
    try { rel = decodeURIComponent(raw); } catch { throw notFound("File not found"); }
    // No traversal: refuse before touching the disk.
    if (!rel || rel.includes("\0") || rel.includes("\\") || path.isAbsolute(rel) || rel.split("/").some((s) => s === ".." || s === "." || s === "")) throw notFound("File not found");
    const target = path.resolve(root, rel);
    if (!isInside(root, target)) throw notFound("File not found");

    const mine = (await recordedFiles(db, c.get("user").id)).some((p) => recordedTarget(root, p) === target);
    if (!mine) throw notFound("File not found");
    return sendFile(target, TYPES[path.extname(target).toLowerCase()] !== "application/zip", path.basename(target), root, ctx.files);
  });

  return r;
}
