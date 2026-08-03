import { getConversationDocumentArchive } from "@/db/conversation-document-archives"
import { isBrowserResourceId, isChatThreadId } from "@/lib/chat-session"
import type { ConversationDocumentArchiveDetailResponse } from "@/lib/conversation-document-archive"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type ArchiveDetailRouteContext = {
  params: Promise<{ threadId: string; archiveId: string }>
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  context: ArchiveDetailRouteContext
) {
  const resourceId = new URL(request.url).searchParams.get("resourceId")
  const { threadId, archiveId } = await context.params

  if (
    !isBrowserResourceId(resourceId) ||
    !isChatThreadId(threadId) ||
    !uuidPattern.test(archiveId)
  ) {
    return Response.json({ error: "无效的存档标识" }, { status: 400 })
  }

  try {
    // 查询同时按 resourceId 和 threadId 过滤，存档 ID 本身不足以作为访问凭证。
    const archive = await getConversationDocumentArchive(
      resourceId,
      threadId,
      archiveId
    )

    if (!archive) {
      return Response.json({ error: "文档存档不存在" }, { status: 404 })
    }

    const response: ConversationDocumentArchiveDetailResponse = { archive }

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("读取文档存档详情失败", error)
    return Response.json({ error: "读取文档存档详情失败" }, { status: 500 })
  }
}
