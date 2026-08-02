"use client"

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
} from "react"

import { AgentChat } from "@/components/agent-chat"
import { PlateEditor } from "@/components/editor/plate-editor"
import { useDocumentEditor } from "@/components/editor/document-editor-context"
import { cn } from "@/lib/utils"

const MIN_CHAT_WIDTH = 25
const MAX_CHAT_WIDTH = 75

export function DocumentWorkspace() {
  const { isEditorOpen, closeEditor } = useDocumentEditor()
  const workspaceRef = useRef<HTMLDivElement>(null)
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
        "isolate flex h-svh w-full overflow-hidden bg-background",
        isResizing && "select-none"
      )}
    >
      <section
        className={cn(
          "min-w-0",
          !isEditorOpen && "mx-auto max-w-[1280px]"
        )}
        style={isEditorOpen ? { width: `${chatWidth}%` } : { width: "100%" }}
      >
        <AgentChat />
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
        <PlateEditor onClose={closeEditor} />
      </section>
    </main>
  )
}
