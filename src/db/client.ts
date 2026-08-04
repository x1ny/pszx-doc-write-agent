import "server-only"

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { getDatabaseConnectionConfig } from "@/db/environment"
import * as schema from "@/db/schema"

const globalForDatabase = globalThis as typeof globalThis & {
  documentAgentDatabasePool?: Pool
  documentAgentDatabase?: NodePgDatabase<typeof schema>
}

// 连接池延迟创建：next build 收集路由信息时会 import 到这里，
// 构建阶段没有数据库环境变量，顶层建池会直接让构建失败；
// 顺带让 dev 热重载复用同一个连接池。
function getDatabasePool() {
  if (!globalForDatabase.documentAgentDatabasePool) {
    globalForDatabase.documentAgentDatabasePool = new Pool({
      ...getDatabaseConnectionConfig(),
      application_name: "doc-agent-drizzle",
    })
  }

  return globalForDatabase.documentAgentDatabasePool
}

export function getDb() {
  if (!globalForDatabase.documentAgentDatabase) {
    globalForDatabase.documentAgentDatabase = drizzle(getDatabasePool(), {
      schema,
    })
  }

  return globalForDatabase.documentAgentDatabase
}
