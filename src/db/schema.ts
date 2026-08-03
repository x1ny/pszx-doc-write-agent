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

/**
 * 每个 AI 回合结束且文档确实发生变化时留下的一份存档。
 *
 * messageId 指向 Mastra 记忆里的那条 assistant 消息（一个用户回合合并为一条），
 * 因此刷新后可以把存档重新挂回对应的消息气泡。title 在写入时算好并冗余保存，
 * 让列表接口不必附带正文；正文只在用户点开存档时才通过详情接口读取。
 */
export const conversationDocumentArchives = applicationSchema.table(
  "conversation_document_archives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: varchar("resource_id", { length: 160 }).notNull(),
    threadId: varchar("thread_id", { length: 160 }).notNull(),
    messageId: varchar("message_id", { length: 160 }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 160 }),
    source: varchar("source", { length: 24 }).notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    content: jsonb("content").$type<Value>().notNull(),
    markdown: text("markdown").notNull(),
    documentVersion: integer("document_version"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_document_archives_thread_message_uidx").on(
      table.threadId,
      table.messageId
    ),
    index("conversation_document_archives_thread_created_idx").on(
      table.resourceId,
      table.threadId,
      table.createdAt
    ),
  ]
)

export type ConversationDocumentArchive =
  typeof conversationDocumentArchives.$inferSelect
export type NewConversationDocumentArchive =
  typeof conversationDocumentArchives.$inferInsert
