/**
 * Local development: API and worker in one process, sharing one database and one queue.
 *
 * Without DATABASE_URL this uses the embedded PGlite database (PGLITE_DIR, default ./data/pglite) and an in-memory
 * queue, so nothing else needs to be installed. With DATABASE_URL it uses that Postgres and pg-boss, the same as
 * production, where the API and the worker run as separate processes.
 */
import path from "node:path";
import { serve } from "@hono/node-server";
import { connect, migrate } from "@norinote/db";
import { createQueue } from "@norinote/queue";
import { createApp, loadConfig } from "../apps/api/src/index.js";
import { startWorker } from "../apps/worker/src/worker.js";

const url = process.env.DATABASE_URL?.trim() || undefined;
const handle = await connect({ url, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
await migrate(handle);

const queue = createQueue(url ? { connectionString: url } : { adapter: "memory" });
await queue.start();

const worker = await startWorker({ db: handle.db, queue });
const config = loadConfig(process.env);
const app = createApp({ db: handle.db, enqueue: (name, payload, opts) => queue.enqueue(name, payload, opts), config });
const server = serve({ fetch: app.fetch, port: config.port });
console.log(`[dev] api on :${config.port}, worker running, ${url ? "Postgres" : "embedded database"}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await worker.stop();
  await queue.stop();
  await handle.close();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
