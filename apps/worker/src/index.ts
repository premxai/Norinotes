import { pathToFileURL } from "node:url";
import { loadDotEnv } from "@norinote/db";
import { createLogger } from "./log.js";
import { startWorker } from "./worker.js";

export { startWorker } from "./worker.js";
export type { Worker, WorkerOptions } from "./worker.js";
export { loadConfig } from "./config.js";
export type { WorkerConfig } from "./config.js";
export { createPreparer, STANDARD_QUESTIONS } from "./preparer.js";
export { createLogger, scrub } from "./log.js";

async function main(): Promise<void> {
  const log = createLogger();
  const worker = await startWorker({ log });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      // A second signal means "now".
      log.warn("worker.forced_exit", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    log.info("worker.stopping", { signal });
    worker.stop().then(() => process.exit(0), (err) => {
      log.error("worker.stop_failed", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => log.error("unhandled_rejection", { error: reason instanceof Error ? reason.message : String(reason) }));
}

// Run only when started directly (`npm run dev:worker`), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  main().catch((err) => {
    createLogger().error("worker.start_failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
