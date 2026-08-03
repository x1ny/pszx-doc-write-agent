import {
  listConversationDocumentArchives,
  saveConversationDocumentArchive,
} from "@/db/conversation-document-archives"
import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"
import {
  isConversationDocumentArchiveSource,
  type ConversationDocumentArchiveListResponse,
  type CreateConversationDocumentArchiveRequest,
  type CreateConversationDocumentArchiveResponse,
} from "@/lib/conversation-document-archive"
import { getDocumentTitle } from "@/lib/document-title"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type ArchivesRouteContext = {
  params: Promise<{ threadId: string }>
}

function isOptionalId(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= 160)
  )
}

function isOptionalVersion(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (Number.isInteger(value) && Number(value) > 0)
  )
}

function isCreateArchiveRequest(
  value: unknown
): value is CreateConversationDocumentArchiveRequest {
  if (!value || typeof value !== "object") {
    return false
  }

  const body = value as Record<string, unknown>

  return (
    isBrowserResourceId(body.resourceId) &&
    typeof body.messageId === "string" &&
    body.messageId.length > 0 &&
    body.messageId.length <= 160 &&
    isOptionalId(body.toolCallId) &&
    isConversationDocumentArchiveSource(body.source) &&
    typeof body.filename === "string" &&
    Array.isArray(body.content) &&
    typeof body.markdown === "string" &&
    isOptionalVersion(body.documentVersion)
  )
}

async function findOwnedThread(threadId: string, resourceId: string) {
  const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
  const memory = await getDocumentAgentMemory()
  const thread = await memory.getThreadById({ threadId })

  return thread && thread.resourceId === resourceId ? thread : null
}

export async function GET(request: Request, context: ArchivesRouteContext) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")
  const { threadId } = await context.params

  if (!isBrowserResourceId(resourceId) || !isChatThreadId(threadId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  try {
    // 会话可能刚在浏览器建立、还没落库，这时没有存档也不算错误。
    const archives = await listConversationDocumentArchives(
      resourceId,
      threadId
    )
    const response: ConversationDocumentArchiveListResponse = { archives }

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("读取文档存档失败", error)
    return Response.json({ error: "读取文档存档失败" }, { status: 500 })
  }
}

export async function POST(request: Request, context: ArchivesRouteContext) {
  const { threadId } = await context.params
  const body = await request.json().catch(() => null)

  if (!isChatThreadId(threadId) || !isCreateArchiveRequest(body)) {
    return Response.json({ error: "无效的文档存档数据" }, { status: 400 })
  }

  try {
    const thread = await findOwnedThread(threadId, body.resourceId)

    if (!thread) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    const result = await saveConversationDocumentArchive({
      resourceId: body.resourceId,
      threadId,
      messageId: body.messageId,
      toolCallId: body.toolCallId ?? null,
      source: body.source,
      title: getDocumentTitle(body.filename, body.markdown),
      filename: body.filename,
      content: body.content,
      markdown: body.markdown,
      documentVersion: body.documentVersion ?? null,
    })

    if (!result) {
      return Response.json({ error: "保存文档存档失败" }, { status: 500 })
    }

    const response: CreateConversationDocumentArchiveResponse = {
      archive: result.archive,
    }

    return Response.json(response, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("保存文档存档失败", error)
    return Response.json({ error: "保存文档存档失败" }, { status: 500 })
  }
}
