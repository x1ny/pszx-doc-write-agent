"use client"

import {
  DefaultChatTransport,
  type FileUIPart,
} from "ai"
import { useChat } from "@ai-sdk/react"
import {
  AlertTriangle,
  Bot,
  Database,
  FileText,
  FileUp,
  Loader2,
  MessageSquareQuote,
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react"
import { FormEvent, useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import { ArticleOutlineEditor } from "@/components/article-outline-editor"
import { DocumentWriteProgress } from "@/components/document-write-progress"
import { StyleReferenceSelection } from "@/components/style-reference-selection"
import { StyleProfileProgress } from "@/components/style-profile-progress"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDocumentEditor } from "@/components/editor/document-editor-context"
import { useDocumentWriteStream } from "@/components/editor/use-document-write-stream"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Toaster, toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import {
  shouldContinueAfterToolCalls,
  type AssistantAgentUIMessage,
} from "@/lib/agent"
import { outlineSchema, type ArticleOutline } from "@/lib/article-schema"
import type { DocumentMaterial } from "@/lib/document-material"
import type { StyleProfileProgressData } from "@/lib/style-profile-progress"

const resourceStorageKey = "document-agent-resource-id"

function getBrowserResourceId() {
  if (typeof window === "undefined") {
    return "document-agent-server"
  }

  try {
    const existingId = window.localStorage.getItem(resourceStorageKey)

    if (existingId) {
      return existingId
    }

    const resourceId = `browser-${crypto.randomUUID()}`
    window.localStorage.setItem(resourceStorageKey, resourceId)
    return resourceId
  } catch {
    return "document-agent-browser"
  }
}

const transport = new DefaultChatTransport<AssistantAgentUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({
    body,
    id,
    messageId,
    messages,
    trigger,
  }) => ({
    body: {
      ...body,
      messages,
      trigger,
      messageId,
      memory: {
        thread: `chat-${id}`,
        resource: getBrowserResourceId(),
      },
    },
  }),
})

const selectionContextPattern = /<document_selection>([\s\S]*?)<\/document_selection>\s*/

type UploadedFile = {
  id: string
  originalName: string
  mimeType: string
  size: number
  extension: string
  createdAt: string
  viewUrl: string
  downloadUrl: string
}

type FileStatus = {
  type: "success" | "error" | "loading"
  message: string
}

function parseOutlineInput(input: unknown) {
  if (typeof input === "string") {
    try {
      return outlineSchema.safeParse(JSON.parse(input))
    } catch {
      return outlineSchema.safeParse(undefined)
    }
  }

  return outlineSchema.safeParse(input)
}

function renderUserMessage(text: string, key: string) {
  const match = text.match(selectionContextPattern)

  if (!match) return <span key={key}>{text}</span>

  return (
    <span key={key} className="flex flex-col gap-2 whitespace-pre-wrap">
      <span className="flex flex-col gap-1 rounded-md bg-primary-foreground/10 px-2.5 py-2 text-xs">
        <span className="flex items-center gap-1 font-medium">
          <MessageSquareQuote data-icon="inline-start" />
          已引用文档内容
        </span>
        <span className="line-clamp-4 opacity-80">{match[1]}</span>
      </span>
      <span>{text.slice(match[0].length)}</span>
    </span>
  )
}

export function AgentChat() {
  const [input, setInput] = useState("")
  const [selectedReference, setSelectedReference] = useState<string | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)
  const [previewContent, setPreviewContent] = useState("")
  const [previewStatus, setPreviewStatus] = useState<FileStatus | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFileInputRef = useRef<HTMLInputElement>(null)
  const wasBusyRef = useRef(false)
  const resumedOutlineToolsRef = useRef(new Set<string>())
  const resumedStyleReferenceToolsRef = useRef(new Set<string>())
  const [resumedOutlineToolIds, setResumedOutlineToolIds] = useState<Set<string>>(
    () => new Set()
  )
  const [resumedStyleReferenceToolIds, setResumedStyleReferenceToolIds] =
    useState<Set<string>>(() => new Set())
  const {
    applyLocalEdit,
    hasDocument,
    importDocument,
    isEditorOpen,
    readDocument,
    registerPromptAppender,
    revealEditor,
  } = useDocumentEditor()
  const {
    isDocumentStreaming,
    stopDocumentWrite,
    streamDocument,
    writePreparedMarkdown,
  } = useDocumentWriteStream()

  const { messages, sendMessage, addToolOutput, stop, status, error } =
    useChat<AssistantAgentUIMessage>({
      transport,
      async onToolCall({ toolCall }) {
        if (toolCall.dynamic) {
          return
        }

        if (
          toolCall.toolName !== "getDocumentSnapshot" &&
          toolCall.toolName !== "streamDocumentToPlate" &&
          toolCall.toolName !== "writeMarkdownToPlate" &&
          toolCall.toolName !== "applyLocalEdit"
        ) {
          return
        }

        setTimeout(async () => {
          try {
            switch (toolCall.toolName) {
              case "getDocumentSnapshot": {
                const snapshot = readDocument()
  
                if (!snapshot) {
                  throw new Error("编辑器尚未准备好，无法读取当前文档")
                }
  
                addToolOutput({
                  tool: "getDocumentSnapshot",
                  toolCallId: toolCall.toolCallId,
                  output: snapshot,
                })
                return
              }
              case "streamDocumentToPlate": {
                await streamDocument(toolCall.toolCallId, toolCall.input)
  
                addToolOutput({
                  tool: "streamDocumentToPlate",
                  toolCallId: toolCall.toolCallId,
                  output: { success: true },
                })
                return
              }
              case "writeMarkdownToPlate": {
                await writePreparedMarkdown(
                  toolCall.toolCallId,
                  toolCall.input.markdown
                )
  
                addToolOutput({
                  tool: "writeMarkdownToPlate",
                  toolCallId: toolCall.toolCallId,
                  output: { success: true },
                })
                return
              }
              case "applyLocalEdit":
                addToolOutput({
                  tool: "applyLocalEdit",
                  toolCallId: toolCall.toolCallId,
                  output: applyLocalEdit(toolCall.input),
                })
                return
            }
          } catch (toolError) {
            const errorText =
              toolError instanceof DOMException && toolError.name === "AbortError"
                ? "用户已停止文档生成"
                : toolError instanceof Error
                  ? toolError.message
                  : String(toolError)
  
            switch (toolCall.toolName) {
              case "getDocumentSnapshot":
              case "streamDocumentToPlate":
              case "writeMarkdownToPlate":
              case "applyLocalEdit": {
                addToolOutput({
                  tool: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  state: "output-error",
                  errorText,
                })
                return
              }
            }
          }}, 1000)
      },
      sendAutomaticallyWhen: shouldContinueAfterToolCalls,
    })
  const isChatBusy = status === "submitted" || status === "streaming"
  const isBusy = isChatBusy || isDocumentStreaming

  function handleStop() {
    stopDocumentWrite()

    if (isChatBusy) {
      void stop()
    }
  }

  useEffect(() => {
    return registerPromptAppender((text) => {
      setSelectedReference(text)
      if (false) setInput((current) => {
        const quote = `\n\n【选中内容】\n${text}\n【处理要求】\n`
        return current.trim() ? `${current}${quote}` : quote.trimStart()
      })
      inputRef.current?.focus()
    })
  }, [registerPromptAppender])

  useEffect(() => {
    if (wasBusyRef.current && !isBusy) {
      inputRef.current?.focus()
    }

    wasBusyRef.current = isBusy
  }, [isBusy])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()

    if ((!text && uploadedFiles.length === 0) || isBusy) {
      return
    }

    const messageText = selectedReference
      ? `<document_selection>${selectedReference}</document_selection>${text}`
      : text

    const attachments = uploadedFiles
    setInput("")
    setSelectedReference(null)
    setUploadedFiles([])
    const fileParts: FileUIPart[] = attachments.map((file) => ({
      type: "file",
      url: file.viewUrl,
      mediaType: file.mimeType,
      filename: file.originalName,
    }))

    await sendMessage({
      text: messageText || "请阅读我上传的文件。",
      files: fileParts,
    })
  }

  function hasDocumentContent() {
    const snapshot = readDocument()

    return (
      snapshot?.blocks.some(
        (block) => block.type !== "p" || block.text.trim().length > 0
      ) ?? false
    )
  }

  async function handleDocumentImport(file: File) {
    if (
      hasDocumentContent() &&
      !window.confirm("导入文档将替换当前内容，确定继续吗？")
    ) {
      return
    }

    try {
      await importDocument(file)
      revealEditor()
    } catch (error) {
      toast.add({
        type: "error",
        title: "导入文档失败",
        description:
          error instanceof Error
            ? error.message
            : "导入失败，请检查文件格式后重试",
        timeout: 5000,
      })
    }
  }

  function formatFileSize(size: number) {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleFileUpload(file: File) {
    const toastId = toast.add({
      type: "loading",
      title: "正在上传文件…",
      timeout: 0,
    })

    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      })
      const result = (await response.json()) as UploadedFile & { error?: string }

      if (!response.ok) {
        throw new Error(result.error || "文件上传失败")
      }

      setUploadedFiles((current) => [
        ...current.filter((item) => item.id !== result.id),
        result,
      ])
      toast.update(toastId, {
        type: "success",
        title: "文件已上传",
        description: file.name,
        timeout: 3000,
      })
    } catch (error) {
      toast.update(toastId, {
        type: "error",
        title: "文件上传失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        timeout: 5000,
      })
    }
  }

  async function handlePreview(file: UploadedFile) {
    setPreviewFile(file)
    setPreviewContent("")
    setPreviewStatus({ type: "loading", message: "正在加载预览…" })

    try {
      const url = new URL(file.viewUrl, window.location.origin)
      url.searchParams.set("preview", "1")
      const response = await fetch(url)
      const result = await response.text()

      if (!response.ok) {
        let message = result || "文件预览失败"

        try {
          const errorResult = JSON.parse(result) as { error?: string }
          message = errorResult.error || message
        } catch {
          // 保留接口返回的纯文本错误信息。
        }

        throw new Error(message)
      }

      setPreviewContent(result)
      setPreviewStatus(null)
    } catch (error) {
      setPreviewStatus({
        type: "error",
        message: error instanceof Error ? error.message : "文件预览失败",
      })
    }
  }

  function handleSuggestedPrompt(prompt: string) {
    if (isBusy) {
      return
    }

    setInput("")
    void sendMessage({ text: prompt })
  }

  const selectedReferencePreview = selectedReference && (
    <div className="mb-2 flex w-full items-start gap-2 rounded-lg border bg-muted/50 p-2.5 text-sm">
      <MessageSquareQuote className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">已选中的文档内容</p>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
          {selectedReference}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="移除选中内容"
        onClick={() => setSelectedReference(null)}
      >
        <X />
      </Button>
    </div>
  )

  const composer = (
    <div className="w-full">
      {selectedReferencePreview}
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "relative flex w-full flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-colors focus-within:border-[#3370ff]",
            uploadedFiles.length > 0
              ? messages.length === 0
                ? "h-44 min-h-44"
                : "h-40 min-h-40"
              : messages.length === 0
                ? "h-32 min-h-32"
                : "h-28 min-h-28"
          )}
        >
          {uploadedFiles.length > 0 && (
            <div className="flex max-h-20 shrink-0 flex-wrap gap-2 overflow-y-auto border-b border-border/70 px-3 pt-3 pb-2">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex min-w-0 max-w-full items-center gap-1 rounded-xl border border-border bg-muted/40 p-1"
                >
                  <button
                    type="button"
                    onClick={() => void handlePreview(file)}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`预览 ${file.originalName}`}
                  >
                    <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 truncate text-xs font-medium text-foreground">
                      {file.originalName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFiles((current) =>
                        current.filter((item) => item.id !== file.id)
                      )
                    }}
                    className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`移除 ${file.originalName}`}
                  >
                    <X data-icon="inline-start" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="min-h-[3.75rem] flex-1 overflow-hidden px-4 pt-3.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="输入消息…"
              aria-label="输入消息"
              rows={messages.length === 0 ? 2 : 1}
              disabled={isBusy}
              className="block h-full min-h-0 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 text-[15px] text-[#1f2329] outline-none ring-0 placeholder:text-[#8f959e] disabled:cursor-not-allowed disabled:opacity-60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            />
          </div>
          <div
            className="flex shrink-0 items-center justify-between gap-3 px-3 pb-3"
            role="toolbar"
            aria-label="输入工具栏"
          >
            <div className="flex min-w-0 items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]

                  if (file) {
                    void handleDocumentImport(file)
                  }

                  event.target.value = ""
                }}
              />
              <input
                ref={uploadFileInputRef}
                type="file"
                accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]

                  if (file) {
                    void handleFileUpload(file)
                  }

                  event.target.value = ""
                }}
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#646a73] transition-colors outline-none hover:bg-[#f3f4f6] hover:text-[#1f2329] focus-visible:ring-3 focus-visible:ring-[#3370ff]/30 disabled:pointer-events-none disabled:opacity-50"
              >
                <FileUp className="size-4" aria-hidden="true" />
                导入文档
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => uploadFileInputRef.current?.click()}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#646a73] transition-colors outline-none hover:bg-[#f3f4f6] hover:text-[#1f2329] focus-visible:ring-3 focus-visible:ring-[#3370ff]/30"
              >
                <Paperclip className="size-4" aria-hidden="true" />
                上传文件
              </button>
            </div>
            <button
              type={isBusy ? "button" : "submit"}
              disabled={!isBusy && !input.trim() && uploadedFiles.length === 0}
              aria-label={isBusy ? "停止生成" : "发送消息"}
              onClick={isBusy ? handleStop : undefined}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg bg-[#3370ff] text-white transition-colors outline-none hover:bg-[#3370ff]/90 focus-visible:ring-3 focus-visible:ring-[#3370ff]/30 disabled:pointer-events-none disabled:opacity-50"
            >
              {isBusy ? (
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </form>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Enter 发送 · Shift + Enter 换行
      </p>
    </div>
  )

  return (
    <Toaster>
      <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {hasDocument && !isEditorOpen && (
        <div className="flex h-12 shrink-0 items-center justify-end border-b px-6">
          <Button type="button" variant="outline" size="sm" onClick={revealEditor}>
            <FileText data-icon="inline-start" />
            打开文档
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 px-8">
        <div className="mx-auto flex h-full w-full max-w-[1000px] flex-col">
          <div className="min-h-0 flex-1">
            <MessageScrollerProvider autoScroll>
              <MessageScroller className="h-full">
                <MessageScrollerViewport aria-label="消息">
                  <MessageScrollerContent
                    className={cn(
                      "gap-8 py-6",
                      messages.length === 0 && "justify-center"
                    )}
                  >
                {messages.length === 0 ? (
                  <MessageScrollerItem className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                      <Bot className="size-7 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xl font-semibold">有什么我能帮你的吗？</p>
                      <p className="text-sm text-muted-foreground">
                        我可以协助你起草、修改和完善公文。
                      </p>
                    </div>
                    <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2.5">
                      {[{
                        label: '写一篇农村集体“三资”管理专项整治工作要求的公文',
                        prompt: '请根据福建省农村集体“三资”管理专项整治工作要求，结合泉州市实际，起草一份《泉州市农业农村局关于开展农村集体“三资”管理突出问题专项排查整治的通知》',
                      }].map(
                        (item) => (
                          <Button
                            key={item.label}
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleSuggestedPrompt(item.prompt)}
                            className="h-auto rounded-full border-0 bg-[#f3f4f6] px-4 py-2.5 text-left text-sm font-normal leading-snug text-[#646a73] hover:bg-[#e8eaed] hover:text-[#1f2329]"
                          >
                            {item.label}
                          </Button>
                        )
                      )}
                    </div>
                    {composer}
                  </MessageScrollerItem>
                ) : (
                  messages.map((message) => {
                    const isUser = message.role === "user"
                    const latestStyleProgressPartKeys = new Map<string, string>()
                    const completedStyleRewriteToolIds = new Set<string>()
                    const latestDataRefreshProgressPartKeys = new Map<string, string>()
                    const completedDataRefreshToolIds = new Set<string>()
                    const latestOutlineProgressPartKeys = new Map<string, string>()
                    const completedOutlineToolIds = new Set<string>()
                    const styleProfileProgressByRunId = new Map<
                      string,
                      StyleProfileProgressData[]
                    >()
                    const firstStyleProfileProgressPartKeyByRunId = new Map<
                      string,
                      string
                    >()

                    message.parts.forEach((part, index) => {
                      if (part.type !== "data-style-profile-progress") {
                        return
                      }

                      const progressPartKey =
                        part.id ?? `${message.id}-style-profile-progress-${index}`
                      const events =
                        styleProfileProgressByRunId.get(part.data.runId) ?? []

                      events.push(part.data)
                      styleProfileProgressByRunId.set(part.data.runId, events)

                      if (
                        !firstStyleProfileProgressPartKeyByRunId.has(part.data.runId)
                      ) {
                        firstStyleProfileProgressPartKeyByRunId.set(
                          part.data.runId,
                          progressPartKey
                        )
                      }
                    })

                    message.parts.forEach((part, index) => {
                      if (
                        part.type === "data-tool-call-suspended" &&
                        part.data.toolName === "proposeArticleOutline"
                      ) {
                        completedOutlineToolIds.add(part.data.toolCallId)
                        return
                      }

                      if (part.type !== "data-outline-progress") {
                        return
                      }

                      latestOutlineProgressPartKeys.set(
                        part.data.toolCallId,
                        part.id ?? `${message.id}-outline-progress-${index}`
                      )
                    })

                    message.parts.forEach((part, index) => {
                      if (part.type === "data-style-rewrite-result") {
                        completedStyleRewriteToolIds.add(part.data.toolCallId)
                        return
                      }

                      if (part.type === "data-document-data-refresh-result") {
                        completedDataRefreshToolIds.add(part.data.toolCallId)
                        return
                      }

                      if (part.type !== "data-style-rewrite-progress") {
                        return
                      }

                      const progressKey = part.data.toolCallId
                      latestStyleProgressPartKeys.set(
                        progressKey,
                        part.id ?? `${message.id}-style-progress-${index}`
                      )
                    })

                    message.parts.forEach((part, index) => {
                      if (part.type !== "data-document-data-refresh-progress") {
                        return
                      }

                      const progressKey = part.data.toolCallId
                      latestDataRefreshProgressPartKeys.set(
                        progressKey,
                        part.id ?? `${message.id}-data-refresh-progress-${index}`
                      )
                    })

                    return (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={isUser}
                        className="flex w-full"
                      >
                        <div
                          className={cn(
                            "flex w-full items-start",
                            isUser ? "justify-end" : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "text-sm leading-7",
                              isUser
                                ? "flex max-w-[72%] flex-col items-end gap-2"
                                : "flex max-w-[88%] flex-col gap-4"
                            )}
                          >
                            {isUser ? (
                              <>
                                {message.parts.map((part, index) => {
                                  if (part.type === "file") {
                                    return (
                                      <a
                                        key={`${message.id}-${index}`}
                                        href={part.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex w-fit min-w-44 max-w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/50"
                                      >
                                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                          <FileText className="size-5" aria-hidden="true" />
                                        </span>
                                        <span className="flex min-w-0 flex-col">
                                          <span className="break-all text-sm font-semibold leading-5 text-foreground">
                                            {part.filename || "文件附件"}
                                          </span>
                                          <span className="text-xs leading-4 text-muted-foreground">
                                            文档
                                          </span>
                                        </span>
                                      </a>
                                    )
                                  }

                                  return null
                                })}
                                {message.parts.some((part) => part.type === "text") && (
                                  <div className="max-w-full rounded-2xl bg-muted px-4 py-2.5 text-foreground">
                                    <span className="flex flex-col gap-2">
                                      {message.parts.map((part, index) =>
                                        part.type === "text"
                                          ? renderUserMessage(
                                              part.text,
                                              `${message.id}-${index}`
                                            )
                                          : null
                                      )}
                                    </span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <Streamdown isAnimating={isBusy}>
                                  {message.parts
                                    .filter((part) => part.type === "text")
                                    .map((part) => part.text)
                                    .join("")}
                                </Streamdown>
                                {message.parts.map((part, index) => {
                                  if (part.type === "tool-streamDocumentToPlate") {
                                    return (
                                      <DocumentWriteProgress
                                        key={part.toolCallId}
                                        part={part}
                                        isDocumentStreaming={isDocumentStreaming}
                                      />
                                    )
                                  }

                                  if (part.type === "data-style-profile-progress") {
                                    const progressPartKey =
                                      part.id ??
                                      `${message.id}-style-profile-progress-${index}`

                                    if (
                                      firstStyleProfileProgressPartKeyByRunId.get(
                                        part.data.runId
                                      ) !== progressPartKey
                                    ) {
                                      return null
                                    }

                                    return (
                                      <StyleProfileProgress
                                        key={`style-profile-progress-${part.data.runId}`}
                                        events={
                                          styleProfileProgressByRunId.get(
                                            part.data.runId
                                          ) ?? []
                                        }
                                      />
                                    )
                                  }

                                  if (part.type === "data-outline-progress") {
                                    const data = part.data
                                    const progressPartKey =
                                      part.id ?? `${message.id}-outline-progress-${index}`

                                    if (
                                      latestOutlineProgressPartKeys.get(data.toolCallId) !==
                                        progressPartKey ||
                                      completedOutlineToolIds.has(data.toolCallId)
                                    ) {
                                      return null
                                    }

                                    return (
                                      <ArticleOutlineEditor
                                        key={`outline-progress-${data.toolCallId}`}
                                        outline={data.outline}
                                        isStreaming
                                        onConfirm={() => undefined}
                                      />
                                    )
                                  }

                                  if (part.type === "data-document-data-refresh-progress") {
                                    const data = part.data
                                    const progressPartKey =
                                      part.id ?? `${message.id}-data-refresh-progress-${index}`

                                    if (
                                      latestDataRefreshProgressPartKeys.get(data.toolCallId) !==
                                        progressPartKey ||
                                      completedDataRefreshToolIds.has(data.toolCallId)
                                    ) {
                                      return null
                                    }

                                    const isFound = data.phase === "found"

                                    return (
                                      <div
                                        key={part.id ?? `${data.phase}-${data.toolCallId}`}
                                        className="order-first mt-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground"
                                      >
                                        {isFound ? (
                                          <Database className="size-4 text-primary" aria-hidden="true" />
                                        ) : (
                                          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                                        )}
                                        <span>{data.message}</span>
                                        {data.replacementCount > 0 && (
                                          <span className="text-xs text-muted-foreground/70">
                                            {data.replacementCount} 处
                                          </span>
                                        )}
                                      </div>
                                    )
                                  }

                                  if (part.type === "data-document-data-refresh-result") {
                                    const data = part.data

                                    return (
                                      <div
                                        key={part.id ?? `data-refresh-result-${data.toolCallId}`}
                                        className="order-first mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm"
                                      >
                                        <div className="flex items-center gap-2 font-medium">
                                          <Database className="size-4 text-primary" aria-hidden="true" />
                                          已完成 {data.output.targetYear} 年数据更新
                                        </div>
                                        <p className="text-muted-foreground">
                                          {data.output.summary}
                                        </p>
                                        {data.output.replacements.length > 0 && (
                                          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                            {data.output.replacements.map((replacement, replacementIndex) => (
                                              <p key={`${data.toolCallId}-replacement-${replacementIndex}`}>
                                                {replacement.original} → {replacement.replacement}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  }

                                  if (part.type === "data-style-rewrite-progress") {
                                    const data = part.data
                                    const progressPartKey =
                                      part.id ?? `${message.id}-style-progress-${index}`

                                    if (
                                      latestStyleProgressPartKeys.get(data.toolCallId) !==
                                        progressPartKey ||
                                      completedStyleRewriteToolIds.has(data.toolCallId)
                                    ) {
                                      return null
                                    }

                                    const isSearching = data.phase === "searching"
                                    const isFound = data.phase === "found"

                                    return (
                                      <div
                                        key={part.id ?? `${data.phase}-${data.leaderName}`}
                                        className="order-first mt-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground"
                                      >
                                        {isFound ? (
                                          <Database className="size-4 text-primary" aria-hidden="true" />
                                        ) : (
                                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                        )}
                                        <span>{data.message}</span>
                                        {isSearching && (
                                          <span className="text-xs text-muted-foreground/70">
                                            历史材料检索
                                          </span>
                                        )}
                                      </div>
                                    )
                                  }

                                  if (part.type === "data-style-rewrite-result") {
                                    const data = part.data

                                    return (
                                      <div
                                        key={part.id ?? `style-rewrite-result-${data.toolCallId}`}
                                        className="order-first mt-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground"
                                      >
                                        <Database className="size-4 text-primary" aria-hidden="true" />
                                        <span>
                                          已完成{data.output.leaderName}的写作风格分析，参考了
                                          {data.output.materialCount}篇历史材料
                                        </span>
                                      </div>
                                    )
                                  }

                                  if (part.type !== "tool-verifyKnowledgeBase") {
                                    return null
                                  }

                                  if (part.state === "input-available") {
                                    return (
                                      <div
                                        key={part.toolCallId}
                                        className="order-first mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm"
                                      >
                                        <div className="flex items-center gap-2 font-medium">
                                          <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                          正在进行知识库核验
                                        </div>
                                        <p className="text-muted-foreground">
                                          核验内容：{part.input.question}
                                        </p>
                                      </div>
                                    )
                                  }

                                  if (part.state === "output-available") {
                                    const rawOutput: unknown = part.output
                                    const output =
                                      typeof rawOutput === "string"
                                        ? rawOutput
                                        : typeof rawOutput === "object" &&
                                            rawOutput !== null &&
                                            "answer" in rawOutput
                                          ? String(rawOutput.answer)
                                          : JSON.stringify(rawOutput)

                                    return (
                                      <div
                                        key={part.toolCallId}
                                        className="order-first mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm"
                                      >
                                        <div className="flex items-center gap-2 font-medium">
                                          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
                                          知识库验证结果
                                        </div>
                                        <p className="text-muted-foreground">
                                          核验内容：{part.input.question}
                                        </p>
                                        <Streamdown>{output}</Streamdown>
                                      </div>
                                    )
                                  }

                                  if (part.state === "output-error") {
                                    return (
                                      <p key={part.toolCallId} className="order-first mt-4 text-sm text-destructive">
                                        知识库核验失败：{part.errorText}
                                      </p>
                                    )
                                  }

                                  return null
                                })}
                                {message.parts.map((part) => {
                                  if (part.type !== "data-tool-call-suspended") {
                                    return null
                                  }

                                  const data = part.data

                                  if (
                                    data.toolName !== "proposeArticleOutline" ||
                                    resumedOutlineToolIds.has(data.toolCallId)
                                  ) {
                                    return null
                                  }

                                  const parsedOutline = parseOutlineInput(
                                    data.suspendPayload?.outline
                                  )

                                  if (!parsedOutline.success) {
                                    return null
                                  }

                                  return (
                                    <ArticleOutlineEditor
                                      key={part.id ?? data.toolCallId}
                                      outline={parsedOutline.data}
                                      onConfirm={(editedOutline: ArticleOutline) => {
                                        if (
                                          resumedOutlineToolsRef.current.has(
                                            data.toolCallId
                                          )
                                        ) {
                                          return
                                        }

                                        resumedOutlineToolsRef.current.add(
                                          data.toolCallId
                                        )
                                        setResumedOutlineToolIds((current) =>
                                          new Set(current).add(data.toolCallId)
                                        )
                                        void sendMessage(undefined, {
                                          body: {
                                            runId: data.runId,
                                            resumeData: {
                                              outline: editedOutline,
                                            },
                                          },
                                        })
                                      }}
                                    />
                                  )
                                })}
                                {message.parts.map((part) => {
                                  if (part.type !== "data-tool-call-suspended") {
                                    return null
                                  }

                                  const data = part.data
                                  const isStyleProfileWorkflow =
                                    data.toolName ===
                                      "workflow-buildStyleProfileWorkflow" ||
                                    data.toolName === "buildStyleProfileWorkflow"

                                  if (
                                    !isStyleProfileWorkflow ||
                                    resumedStyleReferenceToolIds.has(data.toolCallId) ||
                                    data.suspendPayload?.type !==
                                      "style-reference-selection"
                                  ) {
                                    return null
                                  }

                                  return (
                                    <StyleReferenceSelection
                                      key={part.id ?? data.toolCallId}
                                      payload={data.suspendPayload}
                                      onPreview={(material: DocumentMaterial) =>
                                        void handlePreview(material)
                                      }
                                      onConfirm={(
                                        selectedDocumentIds,
                                        additionalCandidates
                                      ) => {
                                        if (
                                          resumedStyleReferenceToolsRef.current.has(
                                            data.toolCallId
                                          )
                                        ) {
                                          return
                                        }

                                        resumedStyleReferenceToolsRef.current.add(
                                          data.toolCallId
                                        )
                                        setResumedStyleReferenceToolIds((current) =>
                                          new Set(current).add(data.toolCallId)
                                        )
                                        void sendMessage(undefined, {
                                          body: {
                                            runId: data.runId,
                                            resumeData: {
                                              selectedDocumentIds,
                                              additionalCandidates,
                                            },
                                          },
                                        })
                                      }}
                                    />
                                  )
                                })}
                              </>
                            )}
                          </div>
                        </div>
                      </MessageScrollerItem>
                    )
                  })
                )}

                {isBusy && (
                  <MessageScrollerItem className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Agent 正在思考…
                  </MessageScrollerItem>
                )}

                {error && (
                  <MessageScrollerItem className="text-sm text-destructive">
                    请求失败：{error.message || "请稍后重试"}
                  </MessageScrollerItem>
                )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>

          {messages.length > 0 && (
            <footer className="shrink-0 pb-6 pt-3">
              {composer}
            </footer>
          )}
        </div>
      </div>

      <Dialog
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null)
            setPreviewStatus(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{previewFile?.originalName || "文件预览"}</DialogTitle>
            <DialogDescription>
              {previewFile
                ? `${previewFile.extension.toUpperCase().replace(".", "")} · ${formatFileSize(previewFile.size)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4">
            {previewStatus?.type === "loading" && (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {previewStatus.message}
              </div>
            )}
            {previewStatus?.type === "error" && (
              <div className="flex h-64 items-center justify-center text-sm text-destructive">
                {previewStatus.message}
              </div>
            )}
            {!previewStatus && (
              <pre className="max-h-[min(560px,calc(100vh-12rem))] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-4 text-sm leading-6 text-foreground">
                {previewContent || "文件没有可预览的文本内容。"}
              </pre>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      </div>
    </Toaster>
  )
}
