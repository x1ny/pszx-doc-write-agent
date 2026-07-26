"use client"

import { DefaultChatTransport } from "ai"
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { useChat } from "@ai-sdk/react"
import {
  AlertTriangle,
  Bot,
  Database,
  Loader2,
  MessageSquareQuote,
  Send,
  Sparkles,
  X,
  User,
} from "lucide-react"
import { FormEvent, useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ArticleOutlineEditor } from "@/components/article-outline-editor"
import { Button } from "@/components/ui/button"
import { useDocumentEditor } from "@/components/editor/document-editor-context"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { AssistantAgentUIMessage } from "@/lib/agent"
import { outlineSchema, type ArticleOutline } from "@/lib/article-schema"

const transport = new DefaultChatTransport({ api: "/api/chat" })

const selectionContextPattern = /<document_selection>([\s\S]*?)<\/document_selection>\s*/

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
    readDocument,
    registerPromptAppender,
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
        addToolOutput({
          tool: "writeMarkdownToPlate",
          toolCallId: part.toolCallId,
          output: { success: true },
        })
      }
    }
  }, [addToolOutput, messages, writeMarkdown])

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

  function handleSuggestedPrompt() {
    if (isBusy) {
      return
    }

    setInput("")
    void sendMessage({
      text: "请帮我写一篇公文：关于推动人工智能发展的建议",
    })
  }

  return (
    <Card className="flex h-[calc(100svh-3rem)] min-h-[36rem] w-full max-w-xl flex-col">
      <CardHeader className="gap-3 border-b">
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="rounded-xl">
            <AvatarFallback className="rounded-xl bg-primary text-primary-foreground">
              <Sparkles aria-hidden="true" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <CardTitle>公文写作助手</CardTitle>
            <CardDescription>品尚征信 · Early Preview</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="h-full">
            <MessageScrollerViewport aria-label="消息">
              <MessageScrollerContent className="gap-10 p-5">
            {messages.length === 0 ? (
              <MessageScrollerItem className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
                  <Bot className="size-6 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="font-medium">你好，我是你的公文写作助手</p>
                  <p className="text-sm text-muted-foreground">
                    请问你需要我帮你写什么类型的公文？
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
                    className={`flex w-full items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <Avatar size="sm" aria-hidden="true">
                        <AvatarFallback>
                          <Bot />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        "max-w-[82%] text-sm leading-6",
                        !isUser && "flex flex-col gap-4",
                        isUser &&
                          "rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground whitespace-pre-wrap"
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
                            if (
                              part.type !== "tool-proposeArticleOutline" ||
                              part.state !== "input-available"
                            ) {
                              return null
                            }

                            const outline = outlineSchema.parse(part.input)

                            return (
                              <ArticleOutlineEditor
                                key={part.toolCallId}
                                outline={outline}
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
                    {isUser && (
                      <Avatar size="sm" aria-hidden="true">
                        <AvatarFallback>
                          <User />
                        </AvatarFallback>
                      </Avatar>
                    )}
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
      </CardContent>

      <Separator />
      <CardFooter className="block p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={handleSuggestedPrompt}
          >
            请帮我写一篇公文
          </Button>
        </div>
        {selectedReference && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border bg-muted/50 p-2.5 text-sm">
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
        <form onSubmit={handleSubmit}>
          <InputGroup className="min-h-10">
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
            placeholder="输入消息，按 Enter 发送…"
            aria-label="输入消息"
            rows={2}
            disabled={isBusy}
            className="max-h-32 min-h-10 resize-none"
            />
            <InputGroupAddon align="inline-end">
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
        <p className="mt-2 text-xs text-muted-foreground">
          Enter 发送 · Shift + Enter 换行
        </p>
      </CardFooter>
    </Card>
  )
}


