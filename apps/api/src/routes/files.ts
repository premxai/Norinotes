import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { and, applications, eq, resumes, sql } from "@norinote/db";
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

/** Streams a file as the response. 404 when it is missing or not a regular file. */
async function sendFile(file: string, inline: boolean, name: string): Promise<Response> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw notFound("File not found");
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(info.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
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
    return sendFile(target, true, "resume.pdf");
  });

  return r;
}

export function artifactRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const root = ctx.config.artifactsDir;
  const PREFIX = "/api/artifacts/";

  /** Every file recorded on this user's applications: receipt screenshots and traces, resume PDFs. */
  async function recordedFiles(userId: string): Promise<string[]> {
    const receipts = await db.select({ shot: sql<string | null>`${applications.receipt}->>'screenshotPath'`, trace: sql<string | null>`${applications.receipt}->>'tracePath'` })
      .from(applications).where(eq(applications.userId, userId));
    const pdfs = await db.select({ p: resumes.pdfPath }).from(resumes).innerJoin(applications, eq(applications.id, resumes.applicationId)).where(eq(applications.userId, userId));
    return [...receipts.flatMap((x) => [x.shot, x.trace]), ...pdfs.map((x) => x.p)].filter((p): p is string => !!p);
  }

  r.get("/*", auth, async (c) => {
    const raw = c.req.path.startsWith(PREFIX) ? c.req.path.slice(PREFIX.length) : "";
    let rel: string;
    try { rel = decodeURIComponent(raw); } catch { throw notFound("File not found"); }
    // No traversal: refuse before touching the disk.
    if (!rel || rel.includes("\0") || rel.includes("\\") || path.isAbsolute(rel) || rel.split("/").some((s) => s === ".." || s === "." || s === "")) throw notFound("File not found");
    const target = path.resolve(root, rel);
    if (!isInside(root, target)) throw notFound("File not found");

    const mine = (await recordedFiles(c.get("user").id)).some((p) => {
      if (path.isAbsolute(p)) return path.resolve(p) === target;
      // A relative record ("artifacts/x.png" or "x.png") is under the artifacts directory.
      return path.resolve(root, p.replace(/^.*artifacts[\\/]/, "")) === target;
    });
    if (!mine) throw notFound("File not found");
    return sendFile(target, TYPES[path.extname(target).toLowerCase()] !== "application/zip", path.basename(target));
  });

  return r;
}
