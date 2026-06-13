import { defineConfig } from "drizzle-kit"

// Generates SQL migrations from src/db/schema.ts into ./migrations,
// which `wrangler d1 migrations apply` then runs against D1.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
})
