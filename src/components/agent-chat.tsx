"use client"

import { DefaultChatTransport } from "ai"
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { useChat } from "@ai-sdk/react"
import {
  AlertTriangle,
  Bot,
  Database,
  FileText,
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
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

const transport = new DefaultChatTransport({ api: "/api/chat" })

const selectionContextPattern = /<document_selection>([\s\S]*?)<\/document_selection>\s*/

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const wasBusyRef = useRef(false)
  const handledMarkdownToolsRef = useRef(new Set<string>())
  const streamedMarkdownRef = useRef(new Map<string, string>())
  const {
    applyLocalEdit,
    hasDocument,
    isEditorOpen,
    readDocument,
    registerPromptAppender,
    revealEditor,
    writeMarkdown,
  } = useDocumentEditor()
  const { messages, sendMessage, addToolOutput, status, error } =
    useChat<AssistantAgentUIMessage>({
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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

  function handleSuggestedPrompt(prompt: string) {
    if (isBusy) {
      return
    }

    setInput("")
    void sendMessage({ text: prompt })
  }

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

      <div className="min-h-0 flex-1">
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="h-full">
            <MessageScrollerViewport aria-label="消息">
              <MessageScrollerContent
                className={cn(
                  "mx-auto w-full max-w-[1000px] gap-8 px-8 py-6",
                  messages.length === 0 && "justify-center"
                )}
              >
                {messages.length === 0 ? (
                  <MessageScrollerItem className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                      <Bot className="size-7 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-xl font-semibold">有什么我能帮你的吗？</p>
                      <p className="text-sm text-muted-foreground">
                        我可以协助你起草、修改和完善公文。
                      </p>
                    </div>
                  </MessageScrollerItem>
                ) : (
                  messages.map((message) => {
                    const isUser = message.role === "user"

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
                                {message.parts.map((part) => {
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
                            if (part.type !== "tool-proposeArticleOutline") {
                              return null
                            }

                            if (part.state !== "input-available") {
                              return null
                            }

                            const toolPart = part as typeof part & {
                              rawInput?: unknown
                            }
                            const parsedOutline = parseOutlineInput(
                              toolPart.input ?? toolPart.rawInput
                            )

                            if (!parsedOutline.success) {
                              return null
                            }

                            return (
                              <ArticleOutlineEditor
                                key={part.toolCallId}
                                outline={parsedOutline.data}
                                      onConfirm={(editedOutline: ArticleOutline) =>
                                        addToolOutput({
                                          tool: "proposeArticleOutline",
                                          toolCallId: part.toolCallId,
                                          output: editedOutline,
                                        })
                                      }
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

      <footer className="shrink-0 px-8 pb-6 pt-3">
        {messages.length === 0 && (
          <div className="mx-auto mb-3 flex w-full max-w-[1000px] flex-wrap justify-center gap-2">
            {["请帮我写一篇公文：关于推动人工智能发展的建议"].map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => handleSuggestedPrompt(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        )}

        {selectedReference && (
          <div className="mx-auto mb-2 flex w-full max-w-[1000px] items-start gap-2 rounded-lg border bg-muted/50 p-2.5 text-sm">
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

        <form className="mx-auto w-full max-w-[1000px]" onSubmit={handleSubmit}>
          <InputGroup className="min-h-12 rounded-2xl bg-background shadow-sm">
            <InputGroupTextarea
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
              rows={2}
              disabled={isBusy}
              className="max-h-32 min-h-12 resize-none px-4 py-3"
            />
            <InputGroupAddon align="inline-end" className="pr-3">
              <InputGroupButton
                type="submit"
                size="icon-sm"
                disabled={isBusy || !input.trim()}
                aria-label="发送消息"
              >
                {isBusy ? <Loader2 className="animate-spin" /> : <Send />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="mx-auto mt-2 w-full max-w-[1000px] text-center text-xs text-muted-foreground">
          Enter 发送 · Shift + Enter 换行
        </p>
      </footer>
    </div>
  )
}
