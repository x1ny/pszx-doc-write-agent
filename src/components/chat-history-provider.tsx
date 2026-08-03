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
  initialMessages: AssistantAgentUIMessage[]
  isConversationBusy: boolean
  isConversationLoading: boolean
  historyError: string | null
  refreshThreads: () => Promise<void>
  reloadActiveConversation: () => Promise<void>
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

  const loadConversation = useCallback(
    async (threadId: string) => {
      if (!resourceId || !isChatThreadId(threadId)) {
        return
      }

      const requestId = ++loadRequestIdRef.current
      setActiveThreadId(threadId)
      setInitialMessages([])
      setConversationError(null)
      setIsConversationLoading(true)

      try {
        const messages = await fetchThreadMessages(resourceId, threadId)

        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setInitialMessages(messages)
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
      historyError,
      initialMessages,
      isConversationBusy,
      isConversationLoading,
      refreshThreads,
      reloadActiveConversation,
      resourceId,
      setConversationBusy: setIsConversationBusy,
      threads,
    }),
    [
      activeThreadId,
      conversationError,
      createConversation,
      historyError,
      initialMessages,
      isConversationBusy,
      isConversationLoading,
      refreshThreads,
      reloadActiveConversation,
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
