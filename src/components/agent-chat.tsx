"use client"

import { DefaultChatTransport } from "ai"
import { useChat } from "@ai-sdk/react"
import {
  AlertTriangle,
  Bot,
  Database,
  FileText,
  FileUp,
  Loader2,
  MessageSquareQuote,
  Send,
  X,
} from "lucide-react"
import { FormEvent, useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import { ArticleOutlineEditor } from "@/components/article-outline-editor"
import { Button } from "@/components/ui/button"
import { useDocumentEditor } from "@/components/editor/document-editor-context"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"
import type { AssistantAgentUIMessage } from "@/lib/agent"
import { outlineSchema, type ArticleOutline } from "@/lib/article-schema"

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

const transport = new DefaultChatTransport({
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
const clientToolPartTypes = new Set([
  "tool-writeMarkdownToPlate",
  "tool-getDocumentSnapshot",
  "tool-applyLocalEdit",
  "tool-simulateLeaderStyleAnalysis",
])
type AgentToolPart = Extract<
  AssistantAgentUIMessage["parts"][number],
  { type: `tool-${string}` }
>

function isAgentToolPart(
  part: AssistantAgentUIMessage["parts"][number]
): part is AgentToolPart {
  return part.type.startsWith("tool-")
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
  const [importStatus, setImportStatus] = useState<{
    type: "success" | "error" | "loading"
    message: string
  } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wasBusyRef = useRef(false)
  const handledMarkdownToolsRef = useRef(new Set<string>())
  const streamedMarkdownRef = useRef(new Map<string, string>())
  const handledStyleAnalysisToolsRef = useRef(new Set<string>())
  const autoContinuedToolCallsRef = useRef(new Set<string>())
  const resumedOutlineToolsRef = useRef(new Set<string>())
  const [resumedOutlineToolIds, setResumedOutlineToolIds] = useState<Set<string>>(
    () => new Set()
  )
  const {
    applyLocalEdit,
    hasDocument,
    importDocument,
    isEditorOpen,
    readDocument,
    registerPromptAppender,
    revealEditor,
    writeMarkdown,
  } = useDocumentEditor()

  function shouldAutomaticallyContinue({
    messages,
  }: {
    messages: AssistantAgentUIMessage[]
  }) {
    const lastMessage = messages.at(-1)

    if (
      !lastMessage ||
      lastMessage.role !== "assistant" ||
      lastMessage.parts.some(
        (part) => part.type === "data-tool-call-suspended"
      )
    ) {
      return false
    }

    const toolParts = lastMessage.parts.filter(isAgentToolPart)
    const clientToolParts = toolParts.filter((part) =>
      clientToolPartTypes.has(part.type)
    )
    const pendingClientToolParts = clientToolParts.filter(
      (part) =>
        part.state !== "output-available" && part.state !== "output-error"
    )
    const uncontinuedClientToolParts = clientToolParts.filter(
      (part) => !autoContinuedToolCallsRef.current.has(part.toolCallId)
    )

    if (
      toolParts.length === 0 ||
      clientToolParts.length === 0 ||
      pendingClientToolParts.length > 0 ||
      uncontinuedClientToolParts.length === 0
    ) {
      return false
    }

    for (const part of uncontinuedClientToolParts) {
      autoContinuedToolCallsRef.current.add(part.toolCallId)
    }

    return true
  }

  const { messages, sendMessage, addToolOutput, status, error } =
    useChat<AssistantAgentUIMessage>({
      transport,
      sendAutomaticallyWhen: shouldAutomaticallyContinue,
    })
  const isBusy = status === "submitted" || status === "streaming"

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

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-writeMarkdownToPlate") {
          continue
        }

        // AI SDK 会先把工具参数以 input-streaming 状态逐步传到客户端。
        // markdown 参数是累计值，因此可以直接用它刷新编辑器，让文档边生成边出现。
        if (part.state === "input-streaming") {
          const markdown = part.input?.markdown

          if (
            typeof markdown === "string" &&
            markdown !== streamedMarkdownRef.current.get(part.toolCallId)
          ) {
            streamedMarkdownRef.current.set(part.toolCallId, markdown)
            revealEditor()
            writeMarkdown(markdown)
          }

          continue
        }

        if (
          part.state !== "input-available" ||
          handledMarkdownToolsRef.current.has(part.toolCallId)
        ) {
          continue
        }

        handledMarkdownToolsRef.current.add(part.toolCallId)
        writeMarkdown(part.input.markdown)
        revealEditor()
        addToolOutput({
          tool: "writeMarkdownToPlate",
          toolCallId: part.toolCallId,
          output: { success: true },
        })
      }
    }
  }, [addToolOutput, messages, revealEditor, writeMarkdown])

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type !== "data-style-rewrite-result" ||
          handledStyleAnalysisToolsRef.current.has(part.data.toolCallId)
        ) {
          continue
        }

        const toolCall = messages
          .flatMap((currentMessage) => currentMessage.parts)
          .find(
            (candidate) =>
              candidate.type === "tool-simulateLeaderStyleAnalysis" &&
              candidate.toolCallId === part.data.toolCallId &&
              candidate.state === "input-available"
          )

        if (!toolCall) {
          continue
        }

        handledStyleAnalysisToolsRef.current.add(part.data.toolCallId)
        addToolOutput({
          tool: "simulateLeaderStyleAnalysis",
          toolCallId: part.data.toolCallId,
          output: part.data.output,
        })
      }
    }
  }, [addToolOutput, messages])

  const handledDocumentToolsRef = useRef(new Set<string>())

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          (part.type !== "tool-getDocumentSnapshot" &&
            part.type !== "tool-applyLocalEdit") ||
          part.state !== "input-available" ||
          handledDocumentToolsRef.current.has(part.toolCallId)
        ) {
          continue
        }

        handledDocumentToolsRef.current.add(part.toolCallId)

        if (part.type === "tool-getDocumentSnapshot") {
          const snapshot = readDocument()

          addToolOutput({
            tool: "getDocumentSnapshot",
            toolCallId: part.toolCallId,
            output: snapshot ?? { blocks: [] },
          })
        } else {
          const result = part.input
            ? applyLocalEdit(part.input)
            : { success: false, message: "缺少局部修改参数" }

          addToolOutput({
            tool: "applyLocalEdit",
            toolCallId: part.toolCallId,
            output: result,
          })
        }
      }
    }
  }, [addToolOutput, applyLocalEdit, messages, readDocument])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()

    if (!text || isBusy) {
      return
    }

    const messageText = selectedReference
      ? `<document_selection>${selectedReference}</document_selection>${text}`
      : text

    setInput("")
    setSelectedReference(null)
    await sendMessage({ text: messageText })
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
      setImportStatus(null)
      return
    }

    setImportStatus({ type: "loading", message: "正在导入文档…" })

    try {
      await importDocument(file)
      revealEditor()
      setImportStatus({
        type: "success",
        message: `已导入 ${file.name}`,
      })
    } catch (error) {
      setImportStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "导入失败，请检查文件格式后重试",
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

  const composer = (
    <div className="w-full">
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "relative flex w-full flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-colors focus-within:border-[#3370ff]",
            messages.length === 0 ? "h-32 min-h-32" : "h-28 min-h-28"
          )}
        >
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#646a73] transition-colors outline-none hover:bg-[#f3f4f6] hover:text-[#1f2329] focus-visible:ring-3 focus-visible:ring-[#3370ff]/30"
              >
                <FileUp className="size-4" aria-hidden="true" />
                导入文档
              </button>
              {importStatus && (
                <p
                  className={cn(
                    "truncate text-xs",
                    importStatus.type === "error"
                      ? "text-destructive"
                      : importStatus.type === "success"
                        ? "text-emerald-600"
                        : "text-muted-foreground"
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {importStatus.message}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={isBusy || !input.trim()}
              aria-label="发送消息"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg bg-[#3370ff] text-white transition-colors outline-none hover:bg-[#3370ff]/90 focus-visible:ring-3 focus-visible:ring-[#3370ff]/30 disabled:pointer-events-none disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
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
                      {["请帮我写一篇公文：关于推动人工智能发展的建议"].map(
                        (prompt) => (
                          <Button
                            key={prompt}
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleSuggestedPrompt(prompt)}
                            className="h-auto rounded-full border-0 bg-[#f3f4f6] px-4 py-2.5 text-left text-sm font-normal leading-snug text-[#646a73] hover:bg-[#e8eaed] hover:text-[#1f2329]"
                          >
                            {prompt}
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
                                ? "max-w-[72%] rounded-2xl bg-muted px-4 py-2.5 text-foreground"
                                : "flex max-w-[88%] flex-col gap-4"
                            )}
                          >
                            {isUser ? (
                              message.parts.map((part, index) =>
                                part.type === "text"
                                  ? renderUserMessage(part.text, `${message.id}-${index}`)
                                  : null
                              )
                            ) : (
                              <>
                                <Streamdown isAnimating={isBusy}>
                                  {message.parts
                                    .filter((part) => part.type === "text")
                                    .map((part) => part.text)
                                    .join("")}
                                </Streamdown>
                                {message.parts.map((part, index) => {
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
            {selectedReference && (
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
            )}
            {composer}
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}
