const browserResourceIdPattern = /^browser-[A-Za-z0-9_-]{8,128}$/
const chatThreadIdPattern = /^chat-[A-Za-z0-9_-]{8,128}$/

export const chatResourceStorageKey = "document-agent-resource-id"

export type ChatThreadSummary = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

let fallbackBrowserResourceId: string | null = null

export function isBrowserResourceId(value: unknown): value is string {
  return typeof value === "string" && browserResourceIdPattern.test(value)
}

export function isChatThreadId(value: unknown): value is string {
  return typeof value === "string" && chatThreadIdPattern.test(value)
}

export function createChatThreadId() {
  return `chat-${crypto.randomUUID()}`
}

export function getBrowserResourceId() {
  if (typeof window === "undefined") {
    throw new Error("浏览器会话标识只能在客户端读取")
  }

  try {
    const existingId = window.localStorage.getItem(chatResourceStorageKey)

    if (isBrowserResourceId(existingId)) {
      return existingId
    }

    const resourceId = `browser-${crypto.randomUUID()}`
    window.localStorage.setItem(chatResourceStorageKey, resourceId)
    return resourceId
  } catch {
    fallbackBrowserResourceId ??= `browser-${crypto.randomUUID()}`
    return fallbackBrowserResourceId
  }
}
