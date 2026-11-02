import { defineConfig } from "drizzle-kit";

// Only used to generate SQL (npm run db:generate). It never connects to a database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
});
