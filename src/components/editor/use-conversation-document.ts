"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Value } from "platejs"

import type {
  ConversationDocumentConflictResponse,
  ConversationDocumentData,
  ConversationDocumentResponse,
  SaveConversationDocumentRequest,
  SaveConversationDocumentResponse,
} from "@/lib/conversation-document"

const AUTOSAVE_DELAY_MS = 1_000

export type DocumentPersistenceStatus =
  | "disabled"
  | "loading"
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"

type ConversationDocumentDraft = {
  filename: string
  content: Value
  markdown: string
}

type UseConversationDocumentOptions = {
  resourceId?: string
  threadId?: string
  readDraft: () => ConversationDocumentDraft
  restoreDocument: (document: ConversationDocumentData) => void
  isPersistencePaused: () => boolean
  onDocumentSaved?: (result: SaveConversationDocumentResponse) => void
}

async function getResponseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : fallback
  } catch {
    return fallback
  }
}

function getDraftFingerprint(draft: ConversationDocumentDraft) {
  return JSON.stringify([draft.filename, draft.content, draft.markdown])
}

function getDocumentFingerprint(document: ConversationDocumentData) {
  return JSON.stringify([
    document.filename,
    document.content,
    document.markdown,
  ])
}

export function useConversationDocument({
  resourceId,
  threadId,
  readDraft,
  restoreDocument,
  isPersistencePaused,
  onDocumentSaved,
}: UseConversationDocumentOptions) {
  const enabled = Boolean(resourceId && threadId)
  const [status, setStatus] = useState<DocumentPersistenceStatus>(
    enabled ? "loading" : "disabled"
  )
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const readDraftRef = useRef(readDraft)
  const restoreDocumentRef = useRef(restoreDocument)
  const isPersistencePausedRef = useRef(isPersistencePaused)
  const onDocumentSavedRef = useRef(onDocumentSaved)
  const loadedRef = useRef(false)
  const loadFailedRef = useRef(false)
  const applyingRemoteDocumentRef = useRef(false)
  const dirtyRef = useRef(false)
  const conflictRef = useRef(false)
  const currentVersionRef = useRef<number | null>(null)
  const lastSavedFingerprintRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    readDraftRef.current = readDraft
    restoreDocumentRef.current = restoreDocument
    isPersistencePausedRef.current = isPersistencePaused
    onDocumentSavedRef.current = onDocumentSaved
  }, [
    isPersistencePaused,
    onDocumentSaved,
    readDraft,
    restoreDocument,
  ])

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const drainSaves = useCallback(
    async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
      clearSaveTimer()

      if (
        !enabled ||
        !resourceId ||
        !threadId ||
        !loadedRef.current ||
        applyingRemoteDocumentRef.current ||
        conflictRef.current ||
        isPersistencePausedRef.current()
      ) {
        return
      }

      if (saveInFlightRef.current) {
        return saveInFlightRef.current
      }

      const saveTask = (async () => {
        while (
          dirtyRef.current &&
          loadedRef.current &&
          !conflictRef.current &&
          !isPersistencePausedRef.current()
        ) {
          dirtyRef.current = false

          let draft: ConversationDocumentDraft
          let fingerprint: string

          try {
            draft = readDraftRef.current()
            fingerprint = getDraftFingerprint(draft)
          } catch (draftError) {
            dirtyRef.current = true
            const message =
              draftError instanceof Error
                ? draftError.message
                : "无法读取当前文档"

            if (mountedRef.current) {
              setError(message)
              setStatus("error")
            }
            break
          }

          if (fingerprint === lastSavedFingerprintRef.current) {
            if (mountedRef.current) {
              setError(null)
              setStatus("saved")
            }
            continue
          }

          if (mountedRef.current) {
            setError(null)
            setStatus("saving")
          }

          const requestBody: SaveConversationDocumentRequest = {
            resourceId,
            filename: draft.filename,
            content: draft.content,
            markdown: draft.markdown,
            version: currentVersionRef.current,
          }

          let response: Response

          try {
            response = await fetch(
              `/api/chat/threads/${encodeURIComponent(threadId)}/document`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
                keepalive,
              }
            )
          } catch (requestError) {
            dirtyRef.current = true
            const message =
              requestError instanceof Error
                ? requestError.message
                : "保存文档失败"

            if (mountedRef.current) {
              setError(message)
              setStatus("error")
            }
            break
          }

          if (response.status === 409) {
            const body = (await response.json().catch(() => null)) as
              | ConversationDocumentConflictResponse
              | null

            if (
              body?.currentVersion &&
              Number.isInteger(body.currentVersion)
            ) {
              currentVersionRef.current = body.currentVersion
            }

            dirtyRef.current = true
            conflictRef.current = true

            if (mountedRef.current) {
              setError(body?.error || "文档已在其他页面更新")
              setStatus("conflict")
            }
            break
          }

          if (!response.ok) {
            dirtyRef.current = true
            const message = await getResponseError(response, "保存文档失败")

            if (mountedRef.current) {
              setError(message)
              setStatus("error")
            }
            break
          }

          const result =
            (await response.json()) as SaveConversationDocumentResponse

          currentVersionRef.current = result.document.version
          lastSavedFingerprintRef.current = fingerprint

          if (mountedRef.current) {
            setError(null)
            setStatus(dirtyRef.current ? "dirty" : "saved")
            onDocumentSavedRef.current?.(result)
          }
        }
      })()

      saveInFlightRef.current = saveTask

      try {
        await saveTask
      } finally {
        if (saveInFlightRef.current === saveTask) {
          saveInFlightRef.current = null
        }
      }
    },
    [clearSaveTimer, enabled, resourceId, threadId]
  )

  const markDirty = useCallback(
    ({ immediate = false }: { immediate?: boolean } = {}) => {
      if (
        !enabled ||
        !loadedRef.current ||
        applyingRemoteDocumentRef.current ||
        isPersistencePausedRef.current()
      ) {
        return
      }

      dirtyRef.current = true
      clearSaveTimer()

      if (conflictRef.current) {
        if (mountedRef.current) {
          setStatus("conflict")
        }
        return
      }

      if (mountedRef.current) {
        setError(null)
        setStatus("dirty")
      }

      saveTimerRef.current = setTimeout(
        () => void drainSaves(),
        immediate ? 0 : AUTOSAVE_DELAY_MS
      )
    },
    [clearSaveTimer, drainSaves, enabled]
  )

  const retry = useCallback(() => {
    if (loadFailedRef.current) {
      setLoadAttempt((attempt) => attempt + 1)
      return
    }

    conflictRef.current = false
    dirtyRef.current = true
    setError(null)
    setStatus("dirty")
    void drainSaves()
  }, [drainSaves])

  useEffect(() => {
    mountedRef.current = true

    if (!enabled || !resourceId || !threadId) {
      loadedRef.current = false
      loadFailedRef.current = false
      return
    }

    const currentResourceId = resourceId
    const currentThreadId = threadId
    const controller = new AbortController()
    let cancelled = false

    loadedRef.current = false
    loadFailedRef.current = false
    applyingRemoteDocumentRef.current = false
    dirtyRef.current = false
    conflictRef.current = false
    currentVersionRef.current = null
    lastSavedFingerprintRef.current = null
    clearSaveTimer()
    queueMicrotask(() => {
      if (!cancelled) {
        setError(null)
        setLoadFailed(false)
        setStatus("loading")
      }
    })

    async function loadDocument() {
      try {
        const response = await fetch(
          `/api/chat/threads/${encodeURIComponent(currentThreadId)}/document?resourceId=${encodeURIComponent(currentResourceId)}`,
          { cache: "no-store", signal: controller.signal }
        )

        if (!response.ok) {
          throw new Error(
            await getResponseError(response, "读取会话文档失败")
          )
        }

        const { document } =
          (await response.json()) as ConversationDocumentResponse

        if (cancelled) {
          return
        }

        applyingRemoteDocumentRef.current = true

        if (document) {
          restoreDocumentRef.current(document)
          currentVersionRef.current = document.version
          lastSavedFingerprintRef.current = getDocumentFingerprint(document)
        }

        await Promise.resolve()

        if (cancelled) {
          return
        }

        applyingRemoteDocumentRef.current = false
        loadedRef.current = true
        setLoadFailed(false)
        setStatus(document ? "saved" : "idle")
      } catch (loadError) {
        if (controller.signal.aborted || cancelled) {
          return
        }

        loadFailedRef.current = true
        const message =
          loadError instanceof Error
            ? loadError.message
            : "读取会话文档失败"

        setError(message)
        setLoadFailed(true)
        setStatus("error")
      }
    }

    void loadDocument()

    return () => {
      cancelled = true
      controller.abort()
      clearSaveTimer()

      if (
        loadedRef.current &&
        dirtyRef.current &&
        !conflictRef.current &&
        !isPersistencePausedRef.current()
      ) {
        void drainSaves({ keepalive: true })
      }
    }
  }, [
    clearSaveTimer,
    drainSaves,
    enabled,
    loadAttempt,
    resourceId,
    threadId,
  ])

  useEffect(() => {
    function handlePageHide() {
      if (dirtyRef.current && !conflictRef.current) {
        void drainSaves({ keepalive: true })
      }
    }

    window.addEventListener("pagehide", handlePageHide)

    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      mountedRef.current = false
    }
  }, [drainSaves])

  return {
    error,
    flush: drainSaves,
    isLoading: status === "loading",
    isUnavailable:
      status === "loading" || (status === "error" && loadFailed),
    markDirty,
    retry,
    status,
  }
}
