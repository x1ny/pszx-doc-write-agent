"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type ArticleOutline } from "@/lib/article-schema"

type ArticleOutlineEditorProps = {
  outline: ArticleOutline
  onConfirm: (outline: ArticleOutline) => void
  isStreaming?: boolean
}

export function ArticleOutlineEditor({
  outline,
  onConfirm,
  isStreaming = false,
}: ArticleOutlineEditorProps) {
  const [editedOutline, setEditedOutline] = useState(outline)

  useEffect(() => {
    if (isStreaming) {
      setEditedOutline(outline)
    }
  }, [isStreaming, outline])

  function updateSection(
    sectionIndex: number,
    field: "title" | "purpose" | "keyPoints",
    value: string
  ) {
    setEditedOutline((current) => ({
      ...current,
      sections: current.sections.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              [field]:
                field === "keyPoints"
                  ? value.split("\n").filter((point) => point.trim())
                  : value,
            }
          : section
      ),
    }))
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border bg-background p-4 text-foreground">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">文章大纲</p>
        <Input
          value={editedOutline.title}
          disabled={isStreaming}
          onChange={(event) =>
            setEditedOutline((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          aria-label="文章标题"
          placeholder="文章标题"
        />
        <Textarea
          value={editedOutline.summary}
          disabled={isStreaming}
          onChange={(event) =>
            setEditedOutline((current) => ({
              ...current,
              summary: event.target.value,
            }))
          }
          aria-label="文章摘要"
          placeholder="文章摘要"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-4">
        {editedOutline.sections.map((section, index) => (
          <div key={section.id} className="flex flex-col gap-2 rounded-md p-3">
            <p className="text-xs font-medium text-muted-foreground">
              第 {index + 1} 节
            </p>
            <Input
              value={section.title}
              disabled={isStreaming}
              onChange={(event) =>
                updateSection(index, "title", event.target.value)
              }
              aria-label={`第 ${index + 1} 节标题`}
              placeholder="章节标题"
            />
            <Textarea
              value={section.purpose}
              disabled={isStreaming}
              onChange={(event) =>
                updateSection(index, "purpose", event.target.value)
              }
              aria-label={`第 ${index + 1} 节写作目的`}
              placeholder="本章节的写作目的"
              rows={2}
            />
            <Textarea
              value={section.keyPoints.join("\n")}
              disabled={isStreaming}
              onChange={(event) =>
                updateSection(index, "keyPoints", event.target.value)
              }
              aria-label={`第 ${index + 1} 节要点`}
              placeholder="每行输入一个要点"
              rows={3}
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        disabled={isStreaming}
        onClick={() => onConfirm(editedOutline)}
      >
        确认大纲并生成文章
      </Button>
    </div>
  )
}

