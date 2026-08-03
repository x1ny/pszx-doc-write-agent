import { notFound } from "next/navigation"

import { DocumentWorkspace } from "@/components/document-workspace"
import { isChatThreadId } from "@/lib/chat-session"

export default async function Page({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params

  if (!isChatThreadId(threadId)) {
    notFound()
  }

  return <DocumentWorkspace />
}
