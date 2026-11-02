import path from "node:path";
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { connect, migrate } from "@norinote/db";
import { createQueue } from "@norinote/queue";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

export { createApp } from "./app.js";
export { loadConfig } from "./config.js";
export type { ApiConfig } from "./config.js";
export type { ApiDeps, EnqueueFn } from "./types.js";
export type { Mailer, Mail } from "./mailer.js";

export type RunningApi = { port: number; stop(): Promise<void> };

/** Connects the database, runs migrations, starts the queue and serves on PORT. */
export async function startApi(env: Record<string, string | undefined> = process.env): Promise<RunningApi> {
  const config = loadConfig(env);
  const url = env.DATABASE_URL?.trim() || undefined;
  const handle = await connect({ url, pgliteDir: env.PGLITE_DIR || path.resolve("data/pglite") });
  await migrate(handle);

  const queue = createQueue(url ? { connectionString: url } : { adapter: "memory" });
  await queue.start();
  if (!url) console.warn("[api] DATABASE_URL is not set: embedded database and in-memory queue. A separate worker process will not see these jobs.");

  const app = createApp({ db: handle.db, enqueue: (name, payload, opts) => queue.enqueue(name, payload, opts), config });
  const server: ServerType = serve({ fetch: app.fetch, port: config.port });
  console.log(`[api] listening on :${config.port}`);

  return {
    port: config.port,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await queue.stop();
      await handle.close();
    },
  };
}

// Run only when started directly (`npm run dev:api`), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApi().then((api) => {
    let stopping = false;
    const shutdown = (signal: string) => {
      if (stopping) process.exit(1);
      stopping = true;
      console.log(`[api] ${signal}: stopping`);
      api.stop().then(() => process.exit(0), () => process.exit(1));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }).catch((err) => {
    console.error(`[api] could not start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
