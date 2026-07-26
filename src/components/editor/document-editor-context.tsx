"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"

type MarkdownWriter = (markdown: string) => void
type PromptAppender = (text: string) => void

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
  revealEditor: () => void
  closeEditor: () => void
  registerMarkdownWriter: (writer: MarkdownWriter) => () => void
  writeMarkdown: (markdown: string) => void
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
  const markdownWriterRef = useRef<MarkdownWriter | null>(null)
  const promptAppenderRef = useRef<PromptAppender | null>(null)
  const documentReaderRef = useRef<DocumentReader | null>(null)
  const localEditApplierRef = useRef<LocalEditApplier | null>(null)

  const registerMarkdownWriter = useCallback((writer: MarkdownWriter) => {
    markdownWriterRef.current = writer

    return () => {
      if (markdownWriterRef.current === writer) {
        markdownWriterRef.current = null
      }
    }
  }, [])

  const writeMarkdown = useCallback((markdown: string) => {
    markdownWriterRef.current?.(markdown)
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
        revealEditor,
        closeEditor,
        registerMarkdownWriter,
        writeMarkdown,
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
