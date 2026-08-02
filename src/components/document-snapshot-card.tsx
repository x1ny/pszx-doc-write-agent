"use client"

import { FileText, RotateCcw } from "lucide-react"
import { useState } from "react"
import { Streamdown } from "streamdown"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

export type SavedDocumentSnapshot = {
  createdAt: string
  filename: string
  id: string
  markdown: string
}

type DocumentSnapshotCardProps = {
  onRestore: (snapshot: SavedDocumentSnapshot) => boolean
  snapshot: SavedDocumentSnapshot
}

const snapshotTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
})

function getSnapshotTitle(snapshot: SavedDocumentSnapshot) {
  const filename = snapshot.filename.trim()

  if (filename && filename !== "未命名文档") {
    return filename
  }

  const heading = snapshot.markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]

  return heading?.replace(/[*_`]/g, "").trim() || filename || "未命名文档"
}

function formatSnapshotTime(createdAt: string) {
  const date = new Date(createdAt)

  return Number.isNaN(date.getTime())
    ? createdAt
    : snapshotTimeFormatter.format(date)
}

export function DocumentSnapshotCard({
  onRestore,
  snapshot,
}: DocumentSnapshotCardProps) {
  const [open, setOpen] = useState(false)
  const title = getSnapshotTitle(snapshot)
  const createdAt = formatSnapshotTime(snapshot.createdAt)

  function handleRestore() {
    if (onRestore(snapshot)) {
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="w-full max-w-sm p-px">
        <DialogTrigger
          render={<Card size="sm" className="w-full cursor-pointer" />}
          nativeButton={false}
          aria-label={`预览文档版本：${title}`}
        >
          <CardHeader className="grid-cols-[auto_minmax(0,1fr)] items-center">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate">{title}</CardTitle>
              <CardDescription>创建时间：{createdAt}</CardDescription>
            </div>
          </CardHeader>
        </DialogTrigger>
      </div>

      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>创建时间：{createdAt}</DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
          <ScrollArea className="h-[min(560px,calc(100vh-14rem))] rounded-xl border">
            <div className="px-6 py-5">
              <Streamdown>{snapshot.markdown}</Streamdown>
            </div>
          </ScrollArea>
          <div className="flex justify-end">
            <Button type="button" onClick={handleRestore}>
              <RotateCcw data-icon="inline-start" />
              覆盖当前编辑器
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
