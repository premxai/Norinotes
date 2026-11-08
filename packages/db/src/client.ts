import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import pg from "pg";
import { schema } from "./schema.js";

/** Either backend, typed as the common Drizzle Postgres database. Use this in every function that takes a database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export type DbHandle = {
  db: Db;
  kind: "postgres" | "pglite";
  /** Releases the pool or closes PGlite. */
  close: () => Promise<void>;
};

/**
 * Pool settings for a real Postgres. A request that cannot get a connection fails after 10 s instead of hanging;
 * idle connections are released after 30 s. DB_POOL_MAX sets the size (default 10).
 */
export function poolOptions(connectionString: string, env: Record<string, string | undefined> = process.env) {
  const max = Number.parseInt(env.DB_POOL_MAX ?? "", 10);
  return {
    connectionString,
    max: Number.isInteger(max) && max > 0 ? max : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  };
}

/** Opens PGlite with the vector extension. `dir` is a directory, or undefined / ":memory:" for in memory. */
export async function openPglite(dir?: string): Promise<PGlite> {
  const persistent = dir !== undefined && dir !== ":memory:";
  // PGlite's own mkdir is not recursive: a fresh checkout has no ./data yet.
  if (persistent) mkdirSync(dir, { recursive: true });
  const client = new PGlite({ ...(persistent ? { dataDir: dir } : {}), extensions: { vector, pg_trgm } });
  await client.waitReady;
  return client;
}

/** Applies every pending migration in packages/db/migrations. Safe to call repeatedly. */
export async function migrate(handle: Pick<DbHandle, "db" | "kind">): Promise<void> {
  // The two migrators take differently typed databases; both read the same folder.
  if (handle.kind === "pglite") await migratePglite(handle.db as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  else await migratePg(handle.db as unknown as Parameters<typeof migratePg>[0], { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Connects without migrating. Postgres when `url` is given, otherwise PGlite (persistent under `pgliteDir`, or in memory). */
export async function connect(opts: { url?: string; pgliteDir?: string } = {}): Promise<DbHandle> {
  if (opts.url) {
    const pool: Pool = new pg.Pool(poolOptions(opts.url));
    // A serverless host (Neon) closes idle connections. Without a listener node-postgres turns that into an uncaught
    // error and the process dies; with one, the pool opens a fresh connection next time.
    pool.on("error", (err) => console.warn(`[db] idle connection dropped: ${err.message}`));
    return { db: drizzlePg(pool, { schema }) as unknown as Db, kind: "postgres", close: () => pool.end() };
  }
  const client = await openPglite(opts.pgliteDir);
  return { db: drizzlePglite(client, { schema }) as unknown as Db, kind: "pglite", close: () => client.close() };
}

let shared: Promise<DbHandle> | null = null;

/**
 * The process-wide database, migrated on first use. Postgres when DATABASE_URL is set, otherwise embedded PGlite under
 * PGLITE_DIR (default ./data/pglite; ":memory:" for throwaway).
 */
export function getDb(): Promise<Db> {
  return getHandle().then((h) => h.db);
}

export function getHandle(): Promise<DbHandle> {
  if (!shared) {
    shared = (async () => {
      const handle = await connect({ url: process.env.DATABASE_URL || undefined, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
      await migrate(handle);
      return handle;
    })();
    shared.catch(() => { shared = null; });
  }
  return shared;
}

/** Closes the shared database (tests, graceful shutdown). The next getDb() opens a new one. */
export async function closeDb(): Promise<void> {
  if (!shared) return;
  const handle = await shared;
  shared = null;
  await handle.close();
}

/** Runs raw SQL and returns the rows, typed. Both backends return `{ rows }`; Drizzle's common type hides it. */
export async function queryRows<T = Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
