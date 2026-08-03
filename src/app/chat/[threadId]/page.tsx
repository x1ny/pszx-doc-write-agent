import { notFound } from "next/navigation"

import { DocumentWorkspace } from "@/components/document-workspace"
import { DocumentEditorProvider } from "@/components/editor/document-editor-context"
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

  return (
    <DocumentEditorProvider>
      <DocumentWorkspace />
    </DocumentEditorProvider>
  )
}
