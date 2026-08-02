import { CircleX, FilePenLine } from "lucide-react"

import type { AssistantAgentUIMessage } from "@/lib/agent"
import { cn } from "@/lib/utils"

type StreamDocumentToolPart = Extract<
  AssistantAgentUIMessage["parts"][number],
  { type: "tool-streamDocumentToPlate" }
>

type DocumentWriteProgressProps = {
  part: StreamDocumentToolPart
  isDocumentStreaming: boolean
}

type DocumentWritePhase = "preparing" | "writing" | "completed" | "error"

function getDocumentWritePhase(
  part: StreamDocumentToolPart,
  isDocumentStreaming: boolean
): DocumentWritePhase {
  if (part.state === "output-error" || part.state === "output-denied") {
    return "error"
  }

  if (part.state === "output-available") {
    return part.output.success ? "completed" : "error"
  }

  return isDocumentStreaming ? "writing" : "preparing"
}

function getDocumentMode(part: StreamDocumentToolPart) {
  const mode = part.input?.mode

  if (mode === "create-document" || mode === "replace-document") {
    return mode
  }

  return undefined
}

function getStatusText(
  part: StreamDocumentToolPart,
  phase: DocumentWritePhase
) {
  const mode = getDocumentMode(part)

  if (phase === "writing") {
    return mode === "replace-document"
      ? "正在流式改写当前文档…"
      : "正在流式写入编辑器…"
  }

  if (phase === "completed") {
    return mode === "replace-document"
      ? "当前文档已改写完成"
      : "文档已写入编辑器"
  }

  if (phase === "error") {
    if (part.state === "output-error") {
      return `文档写入失败：${part.errorText}`
    }

    return part.state === "output-denied"
      ? "文档写入未获批准"
      : "文档写入没有成功完成"
  }

  return part.state === "input-streaming"
    ? "正在准备写入内容…"
    : "正在启动编辑器写入…"
}

function DocumentWriteStatusIcon({ phase }: { phase: DocumentWritePhase }) {
  if (phase === "error") {
    return <CircleX className="size-4 text-destructive" aria-hidden="true" />
  }

  return <FilePenLine className="size-4 shrink-0" aria-hidden="true" />
}

export function DocumentWriteProgress({
  part,
  isDocumentStreaming,
}: DocumentWriteProgressProps) {
  const phase = getDocumentWritePhase(part, isDocumentStreaming)
  const isRunning = phase === "preparing" || phase === "writing"

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "order-first mt-4 flex items-center gap-2 self-start text-sm",
        phase === "error"
          ? "text-destructive"
          : phase === "completed"
            ? "text-foreground"
            : "text-muted-foreground"
      )}
    >
      <DocumentWriteStatusIcon phase={phase} />
      <span className={cn(isRunning && "shimmer")}>
        {getStatusText(part, phase)}
      </span>
    </div>
  )
}
