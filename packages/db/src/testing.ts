import { connect, migrate, type Db } from "./client.js";

export type TestDb = { db: Db; close: () => Promise<void> };

/**
 * A fresh, migrated, in-memory PGlite database (with pgvector) that nothing else shares. Call once per test file:
 *
 *   let t: TestDb;
 *   beforeAll(async () => { t = await createTestDb(); });
 *   afterAll(() => t.close());
 */
export async function createTestDb(): Promise<TestDb> {
  const handle = await connect({ pgliteDir: ":memory:" });
  await migrate(handle);
  return { db: handle.db, close: handle.close };
}
