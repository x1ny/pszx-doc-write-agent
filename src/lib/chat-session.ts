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

// crypto.randomUUID 只在安全上下文可用，用局域网 IP 走 http 访问时它是 undefined。
// getRandomValues 没有这个限制，退化到它同样能生成足够随机的会话标识。
function randomSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

export function isBrowserResourceId(value: unknown): value is string {
  return typeof value === "string" && browserResourceIdPattern.test(value)
}

export function isChatThreadId(value: unknown): value is string {
  return typeof value === "string" && chatThreadIdPattern.test(value)
}

export function createChatThreadId() {
  return `chat-${randomSessionId()}`
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

    const resourceId = `browser-${randomSessionId()}`
    window.localStorage.setItem(chatResourceStorageKey, resourceId)
    return resourceId
  } catch {
    fallbackBrowserResourceId ??= `browser-${randomSessionId()}`
    return fallbackBrowserResourceId
  }
}
