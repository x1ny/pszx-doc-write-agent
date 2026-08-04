import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { getDb } from "@/db/client"
import {
  conversationDocuments,
  type ConversationDocument,
} from "@/db/schema"
import type { ConversationDocumentData } from "@/lib/conversation-document"

type SaveConversationDocumentInput = {
  resourceId: string
  threadId: string
  filename: string
  content: ConversationDocument["content"]
  markdown: string
  expectedVersion: number | null
}

type SaveConversationDocumentResult =
  | { status: "saved"; document: ConversationDocumentData }
  | { status: "conflict"; document: ConversationDocumentData | null }

function toConversationDocumentData(
  document: ConversationDocument
): ConversationDocumentData {
  return {
    id: document.id,
    resourceId: document.resourceId,
    threadId: document.threadId,
    filename: document.filename,
    content: document.content,
    markdown: document.markdown,
    version: document.version,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  }
}

export async function getConversationDocument(
  resourceId: string,
  threadId: string
) {
  const [document] = await getDb()
    .select()
    .from(conversationDocuments)
    .where(
      and(
        eq(conversationDocuments.resourceId, resourceId),
        eq(conversationDocuments.threadId, threadId)
      )
    )
    .limit(1)

  return document ? toConversationDocumentData(document) : null
}

export async function deleteConversationDocument(
  resourceId: string,
  threadId: string
) {
  await getDb()
    .delete(conversationDocuments)
    .where(
      and(
        eq(conversationDocuments.resourceId, resourceId),
        eq(conversationDocuments.threadId, threadId)
      )
    )
}

export async function saveConversationDocument({
  resourceId,
  threadId,
  filename,
  content,
  markdown,
  expectedVersion,
}: SaveConversationDocumentInput): Promise<SaveConversationDocumentResult> {
  const now = new Date()

  if (expectedVersion === null) {
    const [createdDocument] = await getDb()
      .insert(conversationDocuments)
      .values({
        resourceId,
        threadId,
        filename,
        content,
        markdown,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          conversationDocuments.resourceId,
          conversationDocuments.threadId,
        ],
      })
      .returning()

    if (createdDocument) {
      return {
        status: "saved",
        document: toConversationDocumentData(createdDocument),
      }
    }
  } else {
    const [updatedDocument] = await getDb()
      .update(conversationDocuments)
      .set({
        filename,
        content,
        markdown,
        version: sql`${conversationDocuments.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationDocuments.resourceId, resourceId),
          eq(conversationDocuments.threadId, threadId),
          eq(conversationDocuments.version, expectedVersion)
        )
      )
      .returning()

    if (updatedDocument) {
      return {
        status: "saved",
        document: toConversationDocumentData(updatedDocument),
      }
    }
  }

  return {
    status: "conflict",
    document: await getConversationDocument(resourceId, threadId),
  }
}
