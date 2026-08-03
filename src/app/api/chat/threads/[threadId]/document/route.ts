import { getConversationDocument, saveConversationDocument } from "@/db/conversation-documents"
import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"
import type {
  ConversationDocumentConflictResponse,
  SaveConversationDocumentRequest,
  SaveConversationDocumentResponse,
} from "@/lib/conversation-document"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DocumentRouteContext = {
  params: Promise<{ threadId: string }>
}

function isDocumentContent(value: unknown) {
  return Array.isArray(value)
}

function isSaveDocumentRequest(
  value: unknown
): value is SaveConversationDocumentRequest {
  if (!value || typeof value !== "object") {
    return false
  }

  const body = value as Record<string, unknown>

  return (
    isBrowserResourceId(body.resourceId) &&
    typeof body.filename === "string" &&
    isDocumentContent(body.content) &&
    typeof body.markdown === "string" &&
    (body.version === null ||
      (Number.isInteger(body.version) && Number(body.version) > 0))
  )
}

function getDocumentThreadTitle(filename: string, markdown: string) {
  const normalizedFilename = filename.replace(/\s+/g, " ").trim()

  if (normalizedFilename && normalizedFilename !== "未命名文档") {
    return normalizedFilename.slice(0, 30)
  }

  const firstContentLine = markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/[*_`~]/g, "")
        .trim()
    )
    .find(Boolean)

  return (firstContentLine || normalizedFilename || "未命名文档").slice(
    0,
    30
  )
}

export async function GET(request: Request, context: DocumentRouteContext) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")
  const { threadId } = await context.params

  if (!isBrowserResourceId(resourceId) || !isChatThreadId(threadId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  try {
    const document = await getConversationDocument(resourceId, threadId)

    return Response.json(
      { document },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("读取会话文档失败", error)
    return Response.json({ error: "读取会话文档失败" }, { status: 500 })
  }
}

export async function PUT(request: Request, context: DocumentRouteContext) {
  const { threadId } = await context.params
  const body = await request.json().catch(() => null)

  if (!isChatThreadId(threadId) || !isSaveDocumentRequest(body)) {
    return Response.json({ error: "无效的会话文档数据" }, { status: 400 })
  }

  try {
    const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
    const memory = await getDocumentAgentMemory()
    const existingThread = await memory.getThreadById({ threadId })

    if (existingThread && existingThread.resourceId !== body.resourceId) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    let threadCreated = false

    if (!existingThread) {
      await memory.createThread({
        threadId,
        resourceId: body.resourceId,
        title: getDocumentThreadTitle(body.filename, body.markdown),
      })
      threadCreated = true
    }

    const result = await saveConversationDocument({
      resourceId: body.resourceId,
      threadId,
      filename: body.filename,
      content: body.content,
      markdown: body.markdown,
      expectedVersion: body.version,
    })

    if (result.status === "conflict") {
      const response: ConversationDocumentConflictResponse = {
        error: "文档已在其他页面更新",
        currentVersion: result.document?.version ?? null,
      }

      return Response.json(response, { status: 409 })
    }

    const response: SaveConversationDocumentResponse = {
      document: result.document,
      threadCreated,
    }

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("保存会话文档失败", error)
    return Response.json({ error: "保存会话文档失败" }, { status: 500 })
  }
}
