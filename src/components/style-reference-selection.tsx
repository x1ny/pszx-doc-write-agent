"use client"

import { Eye, FileUp } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { DocumentMaterial } from "@/lib/document-material"

type StyleReferenceSelectionPayload = {
  type?: "style-reference-selection"
  subject?: { name: string; organization?: string }
  candidates?: DocumentMaterial[]
  defaultSelectedDocumentIds?: string[]
}

export function StyleReferenceSelection({
  payload,
  onConfirm,
  onPreview,
}: {
  payload: StyleReferenceSelectionPayload
  onConfirm: (
    selectedDocumentIds: string[],
    additionalCandidates: DocumentMaterial[]
  ) => void
  onPreview: (material: DocumentMaterial) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const candidates = payload.candidates ?? []
  const [uploadedReferences, setUploadedReferences] = useState<
    DocumentMaterial[]
  >([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(payload.defaultSelectedDocumentIds ?? candidates.map((item) => item.id))
  )
  const [isUploading, setIsUploading] = useState(false)

  function toggleCandidate(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function uploadReference(file: File) {
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/files", { method: "POST", body: formData })
      if (!response.ok) throw new Error("上传失败")
      const uploaded = (await response.json()) as DocumentMaterial
      setUploadedReferences((current) => [...current, uploaded])
      setSelectedIds((current) => new Set(current).add(uploaded.id))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card className="mt-4 w-full min-w-[600px] overflow-visible border border-border ring-0">
      <CardHeader>
        <CardTitle>
          选择{payload.subject?.name ?? "该作者"}的参考材料
        </CardTitle>
        <CardDescription>
          默认已选中全部材料，也可以上传自己的材料并一起参与分析。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {[...candidates, ...uploadedReferences].map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50"
          >
            <label
              htmlFor={"style-reference-" + candidate.id}
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-3"
            >
              <input
                id={"style-reference-" + candidate.id}
                type="checkbox"
                checked={selectedIds.has(candidate.id)}
                onChange={() => toggleCandidate(candidate.id)}
                className="mt-0.5 accent-primary"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">{candidate.title}</span>
                <span className="text-xs text-muted-foreground">
                  {candidate.date} · {candidate.documentType}
                </span>
              </span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="border-0 shadow-none"
              aria-label={"预览" + candidate.title}
              onClick={() => onPreview(candidate)}
            >
              <Eye />
            </Button>
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.md,.markdown,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void uploadReference(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp data-icon="inline-start" />
            {isUploading ? "上传中…" : "上传材料"}
          </Button>
        </div>
        <Button
          type="button"
          disabled={selectedIds.size === 0}
          onClick={() =>
            onConfirm(
              [...selectedIds],
              uploadedReferences
            )
          }
        >
          确认参考材料（{selectedIds.size}）
        </Button>
      </CardFooter>
    </Card>
  )
}
