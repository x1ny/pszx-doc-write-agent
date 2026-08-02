"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"

type PromptAppender = (text: string) => void
type DocumentImporter = (file: File) => Promise<void>

export type DocumentStreamController = {
  begin: (operationId: string) => void
  append: (operationId: string, chunk: string) => void
  commit: (operationId: string) => void
  abort: (operationId: string) => void
}

export type DocumentBlock = {
  path: number[]
  type: string
  text: string
}

export type DocumentSnapshot = {
  blocks: DocumentBlock[]
  markdown?: string
}

export type LocalEdit = {
  path: number[]
  expectedText: string
  targetText: string
  replacement: string
}

type DocumentReader = () => DocumentSnapshot
type LocalEditApplier = (edit: LocalEdit) => {
  success: boolean
  message?: string
}

type DocumentEditorContextValue = {
  hasDocument: boolean
  isEditorOpen: boolean
  isDocumentStreaming: boolean
  revealEditor: () => void
  closeEditor: () => void
  registerDocumentStreamController: (
    controller: DocumentStreamController
  ) => () => void
  beginDocumentStream: (operationId: string) => void
  appendDocumentStream: (operationId: string, chunk: string) => void
  commitDocumentStream: (operationId: string) => void
  abortDocumentStream: (operationId?: string) => void
  registerDocumentImporter: (importer: DocumentImporter) => () => void
  importDocument: (file: File) => Promise<void>
  registerPromptAppender: (appender: PromptAppender) => () => void
  appendToPrompt: (text: string) => void
  registerDocumentReader: (reader: DocumentReader) => () => void
  readDocument: () => DocumentSnapshot | null
  registerLocalEditApplier: (applier: LocalEditApplier) => () => void
  applyLocalEdit: (edit: LocalEdit) => { success: boolean; message?: string }
}

const DocumentEditorContext = createContext<
  DocumentEditorContextValue | undefined
>(undefined)

export function DocumentEditorProvider({ children }: { children: ReactNode }) {
  const [hasDocument, setHasDocument] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isDocumentStreaming, setIsDocumentStreaming] = useState(false)
  const documentStreamControllerRef =
    useRef<DocumentStreamController | null>(null)
  const activeDocumentStreamIdRef = useRef<string | null>(null)
  const documentImporterRef = useRef<DocumentImporter | null>(null)
  const promptAppenderRef = useRef<PromptAppender | null>(null)
  const documentReaderRef = useRef<DocumentReader | null>(null)
  const localEditApplierRef = useRef<LocalEditApplier | null>(null)

  const registerDocumentStreamController = useCallback(
    (controller: DocumentStreamController) => {
      documentStreamControllerRef.current = controller

      return () => {
        if (documentStreamControllerRef.current !== controller) {
          return
        }

        const operationId = activeDocumentStreamIdRef.current

        if (operationId) {
          try {
            controller.abort(operationId)
          } finally {
            activeDocumentStreamIdRef.current = null
            setIsDocumentStreaming(false)
          }
        }

        documentStreamControllerRef.current = null
      }
    },
    []
  )

  const beginDocumentStream = useCallback((operationId: string) => {
    const controller = documentStreamControllerRef.current

    if (!controller) {
      throw new Error("编辑器尚未准备好，无法开始流式写入")
    }

    if (activeDocumentStreamIdRef.current) {
      throw new Error("已有文档正在流式写入")
    }

    controller.begin(operationId)
    activeDocumentStreamIdRef.current = operationId
    setIsDocumentStreaming(true)
  }, [])

  const appendDocumentStream = useCallback(
    (operationId: string, chunk: string) => {
      if (activeDocumentStreamIdRef.current !== operationId) {
        throw new Error("文档流式写入会话已经失效")
      }

      documentStreamControllerRef.current?.append(operationId, chunk)
    },
    []
  )

  const commitDocumentStream = useCallback((operationId: string) => {
    if (activeDocumentStreamIdRef.current !== operationId) {
      throw new Error("文档流式写入会话已经失效")
    }

    const controller = documentStreamControllerRef.current

    if (!controller) {
      throw new Error("编辑器尚未准备好，无法提交流式写入")
    }

    controller.commit(operationId)
    activeDocumentStreamIdRef.current = null
    setIsDocumentStreaming(false)
  }, [])

  const abortDocumentStream = useCallback((operationId?: string) => {
    const activeOperationId = activeDocumentStreamIdRef.current

    if (!activeOperationId || (operationId && operationId !== activeOperationId)) {
      return
    }

    try {
      documentStreamControllerRef.current?.abort(activeOperationId)
    } finally {
      activeDocumentStreamIdRef.current = null
      setIsDocumentStreaming(false)
    }
  }, [])

  const registerDocumentImporter = useCallback((importer: DocumentImporter) => {
    documentImporterRef.current = importer

    return () => {
      if (documentImporterRef.current === importer) {
        documentImporterRef.current = null
      }
    }
  }, [])

  const importDocument = useCallback((file: File) => {
    if (activeDocumentStreamIdRef.current) {
      return Promise.reject(new Error("文档正在流式写入，请先停止生成"))
    }

    const importer = documentImporterRef.current

    if (!importer) {
      return Promise.reject(new Error("编辑器尚未准备好"))
    }

    return importer(file)
  }, [])

  const revealEditor = useCallback(() => {
    setHasDocument(true)
    setIsEditorOpen(true)
  }, [])

  const closeEditor = useCallback(() => {
    setIsEditorOpen(false)
  }, [])

  const registerPromptAppender = useCallback((appender: PromptAppender) => {
    promptAppenderRef.current = appender

    return () => {
      if (promptAppenderRef.current === appender) {
        promptAppenderRef.current = null
      }
    }
  }, [])

  const appendToPrompt = useCallback((text: string) => {
    promptAppenderRef.current?.(text)
  }, [])

  const registerDocumentReader = useCallback((reader: DocumentReader) => {
    documentReaderRef.current = reader

    return () => {
      if (documentReaderRef.current === reader) {
        documentReaderRef.current = null
      }
    }
  }, [])

  const readDocument = useCallback(() => {
    return documentReaderRef.current?.() ?? null
  }, [])

  const registerLocalEditApplier = useCallback((applier: LocalEditApplier) => {
    localEditApplierRef.current = applier

    return () => {
      if (localEditApplierRef.current === applier) {
        localEditApplierRef.current = null
      }
    }
  }, [])

  const applyLocalEdit = useCallback((edit: LocalEdit) => {
    if (activeDocumentStreamIdRef.current) {
      return {
        success: false,
        message: "文档正在流式写入，请先停止生成",
      }
    }

    return (
      localEditApplierRef.current?.(edit) ?? {
        success: false,
        message: "编辑器尚未准备好",
      }
    )
  }, [])

  return (
    <DocumentEditorContext.Provider
      value={{
        hasDocument,
        isEditorOpen,
        isDocumentStreaming,
        revealEditor,
        closeEditor,
        registerDocumentStreamController,
        beginDocumentStream,
        appendDocumentStream,
        commitDocumentStream,
        abortDocumentStream,
        registerDocumentImporter,
        importDocument,
        registerPromptAppender,
        appendToPrompt,
        registerDocumentReader,
        readDocument,
        registerLocalEditApplier,
        applyLocalEdit,
      }}
    >
      {children}
    </DocumentEditorContext.Provider>
  )
}

export function useDocumentEditor() {
  const context = useContext(DocumentEditorContext)

  if (!context) {
    throw new Error(
      "useDocumentEditor must be used inside DocumentEditorProvider"
    )
  }

  return context
}
