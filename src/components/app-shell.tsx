"use client"

import { PanelRightOpen } from "lucide-react"
import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import {
  ChatHistoryProvider,
  useChatHistory,
} from "@/components/chat-history-provider"
import {
  DocumentEditorProvider,
  useDocumentEditor,
} from "@/components/editor/document-editor-context"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatHistoryProvider>
      <AppShellContent>{children}</AppShellContent>
    </ChatHistoryProvider>
  )
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { activeThreadId } = useChatHistory()
  const pageTitle = pathname === "/editor" ? "文档编辑器" : "公文写作助手"
  const routeThreadId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null
  const editorScopeKey = routeThreadId || activeThreadId || pathname

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar />
      <DocumentEditorProvider key={editorScopeKey}>
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            <SidebarTrigger aria-label="切换历史会话侧边栏" />
            <Separator orientation="vertical" className="h-4" />
            <span className="truncate text-sm font-medium">{pageTitle}</span>
            <OpenEditorButton isConversationPage={Boolean(routeThreadId)} />
          </header>
          <Separator />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </SidebarInset>
      </DocumentEditorProvider>
    </SidebarProvider>
  )
}

function OpenEditorButton({
  isConversationPage,
}: {
  isConversationPage: boolean
}) {
  const { isEditorOpen, revealEditor } = useDocumentEditor()

  if (!isConversationPage || isEditorOpen) {
    return null
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={revealEditor}
    >
      <PanelRightOpen data-icon="inline-start" />
      打开编辑器
    </Button>
  )
}
