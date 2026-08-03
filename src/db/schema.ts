import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"
import type { Value } from "platejs"

export const applicationSchema = pgSchema("doc_agent")

/**
 * 每个会话只保存一份当前文档。
 *
 * content 保存 Plate 的原始节点树，用于无损恢复编辑器；markdown 是供 Agent、
 * 搜索和导出使用的派生文本。version 由更新接口用于乐观锁，不代表历史版本。
 */
export const conversationDocuments = applicationSchema.table(
  "conversation_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: varchar("resource_id", { length: 160 }).notNull(),
    threadId: varchar("thread_id", { length: 160 }).notNull(),
    filename: text("filename").notNull(),
    content: jsonb("content").$type<Value>().notNull(),
    markdown: text("markdown").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_documents_resource_thread_uidx").on(
      table.resourceId,
      table.threadId
    ),
    index("conversation_documents_resource_updated_idx").on(
      table.resourceId,
      table.updatedAt
    ),
    check(
      "conversation_documents_version_positive_check",
      sql`${table.version} > 0`
    ),
  ]
)

export type ConversationDocument =
  typeof conversationDocuments.$inferSelect
export type NewConversationDocument =
  typeof conversationDocuments.$inferInsert
