import { toAISdkMessages } from "@mastra/ai-sdk/ui"

import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"
import { restoreUploadedFilePartsFromStored } from "@/lib/uploaded-file-reference"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ threadId: string }>
}

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
