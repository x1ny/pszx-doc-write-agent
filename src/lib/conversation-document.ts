import type { Value } from "platejs"

export type ConversationDocumentData = {
  id: string
  resourceId: string
  threadId: string
  filename: string
  content: Value
  markdown: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ConversationDocumentResponse = {
  document: ConversationDocumentData | null
}

export type SaveConversationDocumentRequest = {
  resourceId: string
  filename: string
  content: Value
  markdown: string
  version: number | null
}

export type SaveConversationDocumentResponse = {
  document: ConversationDocumentData
  threadCreated: boolean
}

export type ConversationDocumentConflictResponse = {
  error: string
  currentVersion: number | null
}
