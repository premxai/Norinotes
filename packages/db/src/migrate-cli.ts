import { closeDb, getHandle } from "./client.js";

const handle = await getHandle();
console.log(`migrations applied (${handle.kind === "postgres" ? "postgres" : "pglite"})`);
await closeDb();
