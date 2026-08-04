import "server-only"

import { and, asc, eq } from "drizzle-orm"

import { getDb } from "@/db/client"
import {
  conversationDocumentArchives,
  type ConversationDocumentArchive,
} from "@/db/schema"
import type {
  ConversationDocumentArchiveDetail,
  ConversationDocumentArchiveSource,
  ConversationDocumentArchiveSummary,
} from "@/lib/conversation-document-archive"

type SaveConversationDocumentArchiveInput = {
  resourceId: string
  threadId: string
  messageId: string
  toolCallId: string | null
  source: ConversationDocumentArchiveSource
  title: string
  filename: string
  content: ConversationDocumentArchive["content"]
  markdown: string
  documentVersion: number | null
}

const summaryColumns = {
  id: conversationDocumentArchives.id,
  threadId: conversationDocumentArchives.threadId,
  messageId: conversationDocumentArchives.messageId,
  toolCallId: conversationDocumentArchives.toolCallId,
  source: conversationDocumentArchives.source,
  title: conversationDocumentArchives.title,
  filename: conversationDocumentArchives.filename,
  documentVersion: conversationDocumentArchives.documentVersion,
  createdAt: conversationDocumentArchives.createdAt,
}

type ArchiveSummaryRow = {
  [Key in keyof typeof summaryColumns]: ConversationDocumentArchive[Key]
}

function toArchiveSummary(
  archive: ArchiveSummaryRow
): ConversationDocumentArchiveSummary {
  return {
    id: archive.id,
    threadId: archive.threadId,
    messageId: archive.messageId,
    toolCallId: archive.toolCallId,
    source: archive.source as ConversationDocumentArchiveSource,
    title: archive.title,
    filename: archive.filename,
    documentVersion: archive.documentVersion,
    createdAt: archive.createdAt.toISOString(),
  }
}

function toArchiveDetail(
  archive: ConversationDocumentArchive
): ConversationDocumentArchiveDetail {
  return {
    ...toArchiveSummary(archive),
    content: archive.content,
    markdown: archive.markdown,
  }
}

export async function listConversationDocumentArchives(
  resourceId: string,
  threadId: string
) {
  const archives = await getDb()
    .select(summaryColumns)
    .from(conversationDocumentArchives)
    .where(
      and(
        eq(conversationDocumentArchives.resourceId, resourceId),
        eq(conversationDocumentArchives.threadId, threadId)
      )
    )
    .orderBy(asc(conversationDocumentArchives.createdAt))

  return archives.map(toArchiveSummary)
}

export async function getConversationDocumentArchive(
  resourceId: string,
  threadId: string,
  archiveId: string
) {
  const [archive] = await getDb()
    .select()
    .from(conversationDocumentArchives)
    .where(
      and(
        eq(conversationDocumentArchives.id, archiveId),
        eq(conversationDocumentArchives.resourceId, resourceId),
        eq(conversationDocumentArchives.threadId, threadId)
      )
    )
    .limit(1)

  return archive ? toArchiveDetail(archive) : null
}

/**
 * 按 (threadId, messageId) 幂等写入。
 *
 * 回合结束的触发点在浏览器，重试、重复渲染和用户重复操作都可能让同一个回合
 * 发起多次请求，唯一索引负责收敛，调用方不需要自己维护防重状态。
 */
export async function saveConversationDocumentArchive({
  resourceId,
  threadId,
  messageId,
  toolCallId,
  source,
  title,
  filename,
  content,
  markdown,
  documentVersion,
}: SaveConversationDocumentArchiveInput) {
  const [createdArchive] = await getDb()
    .insert(conversationDocumentArchives)
    .values({
      resourceId,
      threadId,
      messageId,
      toolCallId,
      source,
      title,
      filename,
      content,
      markdown,
      documentVersion,
    })
    .onConflictDoNothing({
      target: [
        conversationDocumentArchives.threadId,
        conversationDocumentArchives.messageId,
      ],
    })
    .returning(summaryColumns)

  if (createdArchive) {
    return { created: true, archive: toArchiveSummary(createdArchive) }
  }

  const [existingArchive] = await getDb()
    .select(summaryColumns)
    .from(conversationDocumentArchives)
    .where(
      and(
        eq(conversationDocumentArchives.threadId, threadId),
        eq(conversationDocumentArchives.messageId, messageId)
      )
    )
    .limit(1)

  return existingArchive
    ? { created: false, archive: toArchiveSummary(existingArchive) }
    : null
}

export async function deleteConversationDocumentArchives(
  resourceId: string,
  threadId: string
) {
  await getDb()
    .delete(conversationDocumentArchives)
    .where(
      and(
        eq(conversationDocumentArchives.resourceId, resourceId),
        eq(conversationDocumentArchives.threadId, threadId)
      )
    )
}
