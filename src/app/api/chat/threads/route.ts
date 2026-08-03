import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")

  if (!isBrowserResourceId(resourceId)) {
    return Response.json({ error: "无效的会话资源标识" }, { status: 400 })
  }

  try {
    const { getDocumentAgentMemory } = await import("@/mastra/chat-history")
    const memory = await getDocumentAgentMemory()
    const result = await memory.listThreads({
      filter: { resourceId },
      orderBy: { field: "updatedAt", direction: "DESC" },
      page: 0,
      perPage: 100,
    })

    return Response.json(
      {
        threads: result.threads
          .filter((thread) => isChatThreadId(thread.id))
          .map((thread) => ({
            id: thread.id,
            title: thread.title?.trim() || null,
            createdAt: thread.createdAt.toISOString(),
            updatedAt: thread.updatedAt.toISOString(),
          })),
        hasMore: result.hasMore,
        total: result.total,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("读取历史会话失败", error)
    return Response.json({ error: "读取历史会话失败" }, { status: 500 })
  }
}
