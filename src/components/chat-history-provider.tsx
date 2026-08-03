"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"

import type { AssistantAgentUIMessage } from "@/lib/agent"
import {
  createChatThreadId,
  getBrowserResourceId,
  isChatThreadId,
  type ChatThreadSummary,
} from "@/lib/chat-session"
import type {
  ConversationDocumentArchiveListResponse,
  ConversationDocumentArchiveSummary,
} from "@/lib/conversation-document-archive"

type ThreadListResponse = {
  threads: ChatThreadSummary[]
}

type ThreadMessagesResponse = {
  messages: AssistantAgentUIMessage[]
}

type ChatHistoryContextValue = {
  activeThreadId: string | null
  conversationError: string | null
  createConversation: () => void
  deleteThread: (threadId: string) => Promise<void>
  initialDocumentArchives: ConversationDocumentArchiveSummary[]
  initialMessages: AssistantAgentUIMessage[]
  isConversationBusy: boolean
  isConversationLoading: boolean
  historyError: string | null
  refreshThreads: () => Promise<void>
  reloadActiveConversation: () => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  resourceId: string | null
  setConversationBusy: (isBusy: boolean) => void
  threads: ChatThreadSummary[]
}

const ChatHistoryContext = createContext<ChatHistoryContextValue | undefined>(
  undefined
)

async function getResponseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : fallback
  } catch {
    return fallback
  }
}

async function fetchThreads(resourceId: string, signal?: AbortSignal) {
  const response = await fetch(
    `/api/chat/threads?resourceId=${encodeURIComponent(resourceId)}`,
    { cache: "no-store", signal }
  )

  if (!response.ok) {
    throw new Error(await getResponseError(response, "读取历史会话失败"))
  }

  return ((await response.json()) as ThreadListResponse).threads
}

async function renameThreadRequest(
  resourceId: string,
  threadId: string,
  title: string
) {
  const response = await fetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, title }),
    }
  )

  if (!response.ok) {
    throw new Error(await getResponseError(response, "重命名会话失败"))
  }
}

async function deleteThreadRequest(resourceId: string, threadId: string) {
  const response = await fetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}?resourceId=${encodeURIComponent(resourceId)}`,
    { method: "DELETE" }
  )

  if (!response.ok) {
    throw new Error(await getResponseError(response, "删除会话失败"))
  }
}

async function fetchThreadMessages(
  resourceId: string,
  threadId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}?resourceId=${encodeURIComponent(resourceId)}`,
    { cache: "no-store", signal }
  )

  if (!response.ok) {
    throw new Error(await getResponseError(response, "读取会话消息失败"))
  }

  return ((await response.json()) as ThreadMessagesResponse).messages
}

/**
 * 只取存档元数据，正文留到用户点开卡片时再按需请求，
 * 避免把整段会话的历史文档正文压进首屏加载。
 */
async function fetchThreadDocumentArchives(
  resourceId: string,
  threadId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}/document/archives?resourceId=${encodeURIComponent(resourceId)}`,
    { cache: "no-store", signal }
  )

  if (!response.ok) {
    throw new Error(await getResponseError(response, "读取文档存档失败"))
  }

  return ((await response.json()) as ConversationDocumentArchiveListResponse)
    .archives
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function getRouteThreadId(pathname: string) {
  const prefix = "/chat/"

  if (!pathname.startsWith(prefix)) {
    return null
  }

  try {
    const threadId = decodeURIComponent(pathname.slice(prefix.length))
    return isChatThreadId(threadId) ? threadId : null
  } catch {
    return null
  }
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<
    AssistantAgentUIMessage[]
  >([])
  const [initialDocumentArchives, setInitialDocumentArchives] = useState<
    ConversationDocumentArchiveSummary[]
  >([])
  const [isConversationLoading, setIsConversationLoading] = useState(true)
  const [isConversationBusy, setIsConversationBusy] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [conversationError, setConversationError] = useState<string | null>(
    null
  )
  const loadRequestIdRef = useRef(0)
  const syncedRouteRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function initialize() {
      const browserResourceId = getBrowserResourceId()
      let loadedThreads: ChatThreadSummary[] = []
      let nextHistoryError: string | null = null

      try {
        loadedThreads = await fetchThreads(
          browserResourceId,
          controller.signal
        )
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        nextHistoryError = getErrorMessage(error, "读取历史会话失败")
      }

      if (cancelled) {
        return
      }

      setResourceId(browserResourceId)
      setThreads(loadedThreads)
      setActiveThreadId(null)
      setInitialMessages([])
      setInitialDocumentArchives([])
      setHistoryError(nextHistoryError)
      setConversationError(null)
      setIsConversationLoading(false)
    }

    void initialize()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const refreshThreads = useCallback(async () => {
    if (!resourceId) {
      return
    }

    try {
      const nextThreads = await fetchThreads(resourceId)
      setThreads(nextThreads)
      setHistoryError(null)
    } catch (error) {
      setHistoryError(getErrorMessage(error, "读取历史会话失败"))
    }
  }, [resourceId])

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      if (!resourceId) {
        return
      }

      await renameThreadRequest(resourceId, threadId, title)
      await refreshThreads()
    },
    [resourceId, refreshThreads]
  )

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!resourceId) {
        return
      }

      await deleteThreadRequest(resourceId, threadId)

      if (activeThreadId === threadId) {
        ++loadRequestIdRef.current
        setActiveThreadId(null)
        setInitialMessages([])
        setInitialDocumentArchives([])
        setConversationError(null)
      }

      await refreshThreads()
    },
    [resourceId, activeThreadId, refreshThreads]
  )

  const loadConversation = useCallback(
    async (threadId: string) => {
      if (!resourceId || !isChatThreadId(threadId)) {
        return
      }

      const requestId = ++loadRequestIdRef.current
      setActiveThreadId(threadId)
      setInitialMessages([])
      setInitialDocumentArchives([])
      setConversationError(null)
      setIsConversationLoading(true)

      try {
        // 存档是消息之外的附加信息，读取失败只让卡片消失，不阻断整段会话。
        const [messages, archives] = await Promise.all([
          fetchThreadMessages(resourceId, threadId),
          fetchThreadDocumentArchives(resourceId, threadId).catch((error) => {
            console.error("读取文档存档失败", error)
            return [] as ConversationDocumentArchiveSummary[]
          }),
        ])

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setInitialMessages(messages)
        setInitialDocumentArchives(archives)
      } catch (error) {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setConversationError(getErrorMessage(error, "读取会话消息失败"))
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsConversationLoading(false)
        }
      }
    },
    [resourceId]
  )

  const reloadActiveConversation = useCallback(async () => {
    if (activeThreadId) {
      await loadConversation(activeThreadId)
    }
  }, [activeThreadId, loadConversation])

  const createConversation = useCallback(() => {
    if (isConversationBusy) {
      return
    }

    const threadId = createChatThreadId()
    ++loadRequestIdRef.current
    setActiveThreadId(threadId)
    setInitialMessages([])
    setInitialDocumentArchives([])
    setConversationError(null)
    setIsConversationLoading(false)
  }, [isConversationBusy])

  useEffect(() => {
    if (!resourceId || pathname === "/editor") {
      return
    }

    const routeThreadId = getRouteThreadId(pathname)
    const routeKey = routeThreadId
      ? `thread:${routeThreadId}`
      : pathname === "/"
        ? "home"
        : null

    if (!routeKey || syncedRouteRef.current === routeKey) {
      return
    }

    syncedRouteRef.current = routeKey

    if (routeThreadId) {
      queueMicrotask(() => void loadConversation(routeThreadId))
      return
    }

    queueMicrotask(createConversation)
  }, [createConversation, loadConversation, pathname, resourceId])

  const value = useMemo<ChatHistoryContextValue>(
    () => ({
      activeThreadId,
      conversationError,
      createConversation,
      deleteThread,
      historyError,
      initialDocumentArchives,
      initialMessages,
      isConversationBusy,
      isConversationLoading,
      refreshThreads,
      reloadActiveConversation,
      renameThread,
      resourceId,
      setConversationBusy: setIsConversationBusy,
      threads,
    }),
    [
      activeThreadId,
      conversationError,
      createConversation,
      deleteThread,
      historyError,
      initialDocumentArchives,
      initialMessages,
      isConversationBusy,
      isConversationLoading,
      refreshThreads,
      reloadActiveConversation,
      renameThread,
      resourceId,
      threads,
    ]
  )

  return (
    <ChatHistoryContext.Provider value={value}>
      {children}
    </ChatHistoryContext.Provider>
  )
}

export function useChatHistory() {
  const context = useContext(ChatHistoryContext)

  if (!context) {
    throw new Error("useChatHistory 必须在 ChatHistoryProvider 内使用")
  }

  return context
}
