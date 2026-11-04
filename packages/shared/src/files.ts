import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Generated files (tailored resume PDFs, apply screenshots and traces) are written under ARTIFACTS_DIR on the machine
 * that makes them. When S3_* is set they are also copied to S3-compatible object storage (Supabase Storage, R2, Tigris)
 * under the same relative key, so the API on another machine can serve them and a restarted worker can get them back.
 * Without S3_* everything stays on local disk, as in development.
 */
export interface FileStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** The file's bytes, or null when there is no such key. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes every key under `prefix`; returns how many. */
  deletePrefix(prefix: string): Promise<number>;
}

export type S3Options = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch };

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".zip": "application/zip" };

/** Root of the generated files: ARTIFACTS_DIR, or ./data/artifacts. Every package must agree on it for keys to match. */
export function artifactsRoot(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env.ARTIFACTS_DIR?.trim() || path.join("data", "artifacts"));
}

/** `file`'s key: its path relative to `root`, with forward slashes. Null when it is not inside `root`. */
export function storageKey(file: string, root: string): string | null {
  const rel = path.relative(root, path.resolve(file));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** The S3 store when S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are all set, otherwise null. */
export function fileStoreFromEnv(env: Record<string, string | undefined> = process.env): FileStore | null {
  const v = (k: string) => env[k]?.trim() || undefined;
  const endpoint = v("S3_ENDPOINT"), bucket = v("S3_BUCKET"), accessKeyId = v("S3_ACCESS_KEY_ID"), secretAccessKey = v("S3_SECRET_ACCESS_KEY");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return createS3FileStore({ endpoint, bucket, accessKeyId, secretAccessKey, region: v("S3_REGION") ?? "us-east-1" });
}

/** Path-style S3 (`<endpoint>/<bucket>/<key>`), signed with SigV4. Errors carry the status only, never a body. */
export function createS3FileStore(opts: S3Options): FileStore {
  const client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, service: "s3", region: opts.region });
  const doFetch = opts.fetch ?? fetch;
  const base = `${opts.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(opts.bucket)}`;
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (target: string, init: RequestInit = {}): Promise<Response> => doFetch(await client.sign(target, init));
  const fail = (what: string, res: Response): Error => new Error(`File storage ${what} failed (HTTP ${res.status})`);

  return {
    async put(key, body, contentType) {
      const res = await send(url(key), { method: "PUT", body, headers: { "Content-Type": contentType } });
      if (!res.ok) throw fail("upload", res);
    },
    async get(key) {
      const res = await send(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw fail("download", res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async deletePrefix(prefix) {
      let removed = 0;
      let token: string | undefined;
      do {
        const q = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
        const res = await send(`${base}?${q}`);
        if (!res.ok) throw fail("listing", res);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          const del = await send(url(unescapeXml(m[1]!)), { method: "DELETE" });
          if (!del.ok && del.status !== 404) throw fail("delete", del);
          removed++;
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unescapeXml(/<NextContinuationToken>([^<]*)</.exec(xml)?.[1] ?? "") || undefined : undefined;
      } while (token);
      return removed;
    },
  };
}

const unescapeXml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Copies a local file under `root` to the store. Returns false (and copies nothing) when it is outside `root`. */
export async function uploadFile(store: FileStore, file: string, root: string): Promise<boolean> {
  const key = storageKey(file, root);
  if (!key) return false;
  await store.put(key, await readFile(file), TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  return true;
}

/** Makes sure `file` exists on this machine, fetching it from the store when it is missing. False when it cannot. */
export async function ensureLocalFile(store: FileStore | null, file: string, root: string): Promise<boolean> {
  if (existsSync(file)) return true;
  const key = store ? storageKey(file, root) : null;
  if (!store || !key) return false;
  const body = await store.get(key);
  if (!body) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return true;
}
