import { config as loadEnvironment } from "dotenv"
import { defineConfig } from "drizzle-kit"

import { getDatabaseConnectionConfig } from "./src/db/environment"

loadEnvironment({ path: [".env.local", ".env"], quiet: true })

const databaseConnection = getDatabaseConnectionConfig()

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: databaseConnection.host,
    port: databaseConnection.port,
    database: databaseConnection.database,
    user: databaseConnection.user,
    password: databaseConnection.password,
  },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
})
