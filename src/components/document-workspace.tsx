"use client"

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"

import { AgentChat } from "@/components/agent-chat"
import { useChatHistory } from "@/components/chat-history-provider"
import { PlateEditor } from "@/components/editor/plate-editor"
import { useDocumentEditor } from "@/components/editor/document-editor-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SaveConversationDocumentResponse } from "@/lib/conversation-document"

const MIN_CHAT_WIDTH = 25
const MAX_CHAT_WIDTH = 75

export function DocumentWorkspace() {
  const pathname = usePathname()
  const router = useRouter()
  const { isEditorOpen, closeEditor } = useDocumentEditor()
  const {
    activeThreadId,
    conversationError,
    initialMessages,
    isConversationLoading,
    refreshThreads,
    reloadActiveConversation,
    resourceId,
    setConversationBusy,
  } = useChatHistory()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const promotedDocumentThreadRef = useRef<string | null>(null)
  const [chatWidth, setChatWidth] = useState(60)
  const [isResizing, setIsResizing] = useState(false)

  const updateChatWidth = useCallback((clientX: number) => {
    const workspace = workspaceRef.current

    if (!workspace) {
      return
    }

    const bounds = workspace.getBoundingClientRect()
    const nextWidth = ((clientX - bounds.left) / bounds.width) * 100

    setChatWidth(
      Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, nextWidth))
    )
  }, [])

  const handleDocumentSaved = useCallback(
    (result: SaveConversationDocumentResponse) => {
      if (result.threadCreated) {
        void refreshThreads()
      }

      if (
        pathname === "/" &&
        activeThreadId &&
        promotedDocumentThreadRef.current !== activeThreadId
      ) {
        promotedDocumentThreadRef.current = activeThreadId
        void refreshThreads()
        router.replace(`/chat/${encodeURIComponent(activeThreadId)}`)
      }
    },
    [activeThreadId, pathname, refreshThreads, router]
  )

  function handleResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  function handleResizeMove(event: PointerEvent<HTMLDivElement>) {
    if (isResizing) {
      updateChatWidth(event.clientX)
    }
  }

  function handleResizeEnd(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setIsResizing(false)
  }

  return (
    <main
      ref={workspaceRef}
      className={cn(
        "isolate flex h-full w-full overflow-hidden bg-background",
        isResizing && "select-none"
      )}
    >
      <section
        className={cn(
          "h-full min-w-0",
          !isEditorOpen && "mx-auto max-w-[1280px]"
        )}
        style={isEditorOpen ? { width: `${chatWidth}%` } : { width: "100%" }}
      >
        {isConversationLoading || !resourceId || !activeThreadId ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" aria-hidden="true" />
            正在加载会话…
          </div>
        ) : conversationError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-destructive">{conversationError}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reloadActiveConversation()}
            >
              <RefreshCw data-icon="inline-start" />
              重新加载
            </Button>
          </div>
        ) : (
          <AgentChat
            key={activeThreadId}
            threadId={activeThreadId}
            resourceId={resourceId}
            initialMessages={initialMessages}
            onBusyChange={setConversationBusy}
            onConversationUpdated={refreshThreads}
          />
        )}
      </section>

      <div
        className={cn(
          "relative z-10 w-2 shrink-0 cursor-col-resize border-x border-border bg-muted/30 transition-colors hover:bg-primary/20",
          !isEditorOpen && "hidden"
        )}
        role="separator"
        aria-label="调整聊天区和编辑器宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_CHAT_WIDTH}
        aria-valuemax={MAX_CHAT_WIDTH}
        aria-valuenow={Math.round(chatWidth)}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      >
        <span className="absolute top-1/2 left-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border" />
      </div>

      <section
        className={cn(
          "min-w-0 transition-[width] duration-300 ease-out",
          !isEditorOpen && "hidden",
          isEditorOpen && "document-editor-panel--entering"
        )}
        style={isEditorOpen ? { width: `${100 - chatWidth}%` } : undefined}
        aria-hidden={!isEditorOpen}
      >
        <PlateEditor
          key={
            resourceId && activeThreadId
              ? `${resourceId}:${activeThreadId}`
              : "standalone-editor"
          }
          resourceId={resourceId ?? undefined}
          threadId={activeThreadId ?? undefined}
          onDocumentSaved={handleDocumentSaved}
          onClose={closeEditor}
        />
      </section>
    </main>
  )
}
