import type { Value } from "platejs"

/** 目前只有 AI 回合结束和用户恢复历史版本两种存档来源。 */
export const conversationDocumentArchiveSources = [
  "agent-round",
  "restore",
] as const

export type ConversationDocumentArchiveSource =
  (typeof conversationDocumentArchiveSources)[number]

/** 列表接口返回的元数据，刻意不带正文，让会话加载保持轻量。 */
export type ConversationDocumentArchiveSummary = {
  id: string
  threadId: string
  messageId: string
  toolCallId: string | null
  source: ConversationDocumentArchiveSource
  title: string
  filename: string
  documentVersion: number | null
  createdAt: string
}

/** 详情接口返回的完整存档，预览和恢复共用同一次请求。 */
export type ConversationDocumentArchiveDetail =
  ConversationDocumentArchiveSummary & {
    content: Value
    markdown: string
  }

export type ConversationDocumentArchiveListResponse = {
  archives: ConversationDocumentArchiveSummary[]
}

export type ConversationDocumentArchiveDetailResponse = {
  archive: ConversationDocumentArchiveDetail
}

export type CreateConversationDocumentArchiveRequest = {
  resourceId: string
  messageId: string
  toolCallId?: string | null
  source: ConversationDocumentArchiveSource
  filename: string
  content: Value
  markdown: string
  documentVersion?: number | null
}

export type CreateConversationDocumentArchiveResponse = {
  archive: ConversationDocumentArchiveSummary
}

export function isConversationDocumentArchiveSource(
  value: unknown
): value is ConversationDocumentArchiveSource {
  return conversationDocumentArchiveSources.includes(
    value as ConversationDocumentArchiveSource
  )
}
