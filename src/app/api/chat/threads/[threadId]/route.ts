import { toAISdkMessages } from "@mastra/ai-sdk/ui"

import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"
import { restoreUploadedFilePartsFromStored } from "@/lib/uploaded-file-reference"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ threadId: string }>
}

const MAX_TITLE_LENGTH = 100

export async function GET(request: Request, context: RouteContext) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")
  const { threadId } = await context.params

  if (!isBrowserResourceId(resourceId) || !isChatThreadId(threadId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  try {
    const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
    const memory = await getDocumentAgentMemory()
    const thread = await memory.getThreadById({ threadId })

    if (!thread || thread.resourceId !== resourceId) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    const { messages } = await memory.recall({
      threadId,
      resourceId,
      orderBy: { field: "createdAt", direction: "ASC" },
      perPage: false,
    })

    return Response.json(
      {
        thread: {
          id: thread.id,
          title: thread.title?.trim() || null,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString(),
        },
        messages: restoreUploadedFilePartsFromStored(
          toAISdkMessages(messages, { version: "v6" }),
          messages
        ),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("读取会话消息失败", error)
    return Response.json({ error: "读取会话消息失败" }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { threadId } = await context.params

  if (!isChatThreadId(threadId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 })
  }

  const { resourceId, title } = (body ?? {}) as {
    resourceId?: unknown
    title?: unknown
  }

  if (!isBrowserResourceId(resourceId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  if (typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "标题不能为空" }, { status: 400 })
  }

  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH)

  try {
    const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
    const memory = await getDocumentAgentMemory()
    const thread = await memory.getThreadById({ threadId })

    if (!thread || thread.resourceId !== resourceId) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    const updated = await memory.updateThread({
      id: threadId,
      title: trimmedTitle,
      metadata: thread.metadata ?? {},
    })

    return Response.json(
      {
        thread: {
          id: updated.id,
          title: updated.title?.trim() || null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("重命名会话失败", error)
    return Response.json({ error: "重命名会话失败" }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")
  const { threadId } = await context.params

  if (!isBrowserResourceId(resourceId) || !isChatThreadId(threadId)) {
    return Response.json({ error: "无效的会话标识" }, { status: 400 })
  }

  try {
    const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
    const memory = await getDocumentAgentMemory()
    const thread = await memory.getThreadById({ threadId })

    if (!thread || thread.resourceId !== resourceId) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    await memory.deleteThread(threadId)

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error("删除会话失败", error)
    return Response.json({ error: "删除会话失败" }, { status: 500 })
  }
}
