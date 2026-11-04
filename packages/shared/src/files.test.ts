import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createS3FileStore, ensureLocalFile, fileStoreFromEnv, storageKey, uploadFile, type FileStore } from "./files.js";

/** An in-memory store, enough to test the helpers that sit on top of one. */
function memoryStore(): FileStore & { keys: Map<string, Uint8Array> } {
  const keys = new Map<string, Uint8Array>();
  return {
    keys,
    async put(key, body) { keys.set(key, body); },
    async get(key) { return keys.get(key) ?? null; },
    async deletePrefix(prefix) {
      let n = 0;
      for (const k of [...keys.keys()]) if (k.startsWith(prefix)) { keys.delete(k); n++; }
      return n;
    },
  };
}

const dirs: string[] = [];
async function tempRoot(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "nn-files-"));
  dirs.push(d);
  return d;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("storage keys", () => {
  it("is the path under the root with forward slashes, and null outside it", () => {
    const root = path.resolve("/srv/artifacts");
    expect(storageKey(path.join(root, "resumes", "u1", "r.pdf"), root)).toBe("resumes/u1/r.pdf");
    expect(storageKey(path.resolve("/srv/other/r.pdf"), root)).toBeNull();
    expect(storageKey(root, root)).toBeNull();
  });
});

describe("fileStoreFromEnv", () => {
  it("is null until the endpoint, bucket and both keys are set", () => {
    expect(fileStoreFromEnv({})).toBeNull();
    expect(fileStoreFromEnv({ S3_ENDPOINT: "https://x", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" })).toBeNull();
    expect(fileStoreFromEnv({ S3_ENDPOINT: "https://x", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" })).not.toBeNull();
  });
});

describe("upload and fetch back", () => {
  it("copies a file up under its key and restores it on a machine that lacks it", async () => {
    const root = await tempRoot();
    const store = memoryStore();
    const file = path.join(root, "resumes", "u1", "r.pdf");
    await (await import("node:fs/promises")).mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "pdf bytes");
    expect(await uploadFile(store, file, root)).toBe(true);
    expect([...store.keys.keys()]).toEqual(["resumes/u1/r.pdf"]);

    await rm(file);
    expect(await ensureLocalFile(store, file, root)).toBe(true);
    expect(await readFile(file, "utf8")).toBe("pdf bytes");
  });

  it("reports false when neither the disk nor the store has the file", async () => {
    const root = await tempRoot();
    expect(await ensureLocalFile(memoryStore(), path.join(root, "nope.pdf"), root)).toBe(false);
    expect(await ensureLocalFile(null, path.join(root, "nope.pdf"), root)).toBe(false);
  });
});

describe("S3 store", () => {
  it("signs path-style requests and never puts a response body in an error", async () => {
    const seen: Request[] = [];
    const store = createS3FileStore({
      endpoint: "https://proj.storage.example/storage/v1/s3/", region: "us-west-1", bucket: "artifacts", accessKeyId: "AK", secretAccessKey: "SK",
      fetch: (async (req: Request) => { seen.push(req); return new Response("<Error>secret detail</Error>", { status: 403 }); }) as typeof fetch,
    });
    await expect(store.put("resumes/u 1/r.pdf", new Uint8Array([1]), "application/pdf")).rejects.toThrow(/^File storage upload failed \(HTTP 403\)$/);
    expect(seen[0]!.url).toBe("https://proj.storage.example/storage/v1/s3/artifacts/resumes/u%201/r.pdf");
    expect(seen[0]!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-west-1\/s3\/aws4_request/);
  });

  it("treats a missing key as null and pages through a prefix delete", async () => {
    const deleted: string[] = [];
    const store = createS3FileStore({
      endpoint: "https://s3.example", region: "auto", bucket: "b", accessKeyId: "AK", secretAccessKey: "SK",
      fetch: (async (req: Request) => {
        const u = new URL(req.url);
        if (req.method === "DELETE") { deleted.push(u.pathname); return new Response(null, { status: 204 }); }
        if (u.searchParams.get("list-type") === "2") {
          const page2 = u.searchParams.get("continuation-token") === "t&2";
          return new Response(page2
            ? "<ListBucketResult><Key>resumes/u1/b.pdf</Key><IsTruncated>false</IsTruncated></ListBucketResult>"
            : "<ListBucketResult><Key>resumes/u1/a&amp;.pdf</Key><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;2</NextContinuationToken></ListBucketResult>");
        }
        return new Response("no", { status: 404 });
      }) as typeof fetch,
    });
    expect(await store.get("resumes/u1/missing.pdf")).toBeNull();
    expect(await store.deletePrefix("resumes/u1/")).toBe(2);
    expect(deleted).toEqual(["/b/resumes/u1/a%26.pdf", "/b/resumes/u1/b.pdf"]);
  });
});
