import "server-only"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { getDatabaseConnectionConfig } from "@/db/environment"
import * as schema from "@/db/schema"

const globalForDatabase = globalThis as typeof globalThis & {
  documentAgentDatabasePool?: Pool
}

export const databasePool =
  globalForDatabase.documentAgentDatabasePool ??
  new Pool({
    ...getDatabaseConnectionConfig(),
    application_name: "doc-agent-drizzle",
  })

globalForDatabase.documentAgentDatabasePool = databasePool

export const db = drizzle(databasePool, { schema })
