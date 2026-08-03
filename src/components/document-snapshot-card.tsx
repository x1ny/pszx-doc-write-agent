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
import { Skeleton } from "@/components/ui/skeleton"
import type {
  ConversationDocumentArchiveDetail,
  ConversationDocumentArchiveSummary,
} from "@/lib/conversation-document-archive"

type DocumentSnapshotCardProps = {
  archive: ConversationDocumentArchiveSummary
  loadDetail: (
    archiveId: string
  ) => Promise<ConversationDocumentArchiveDetail>
  onRestore: (detail: ConversationDocumentArchiveDetail) => boolean
}

const snapshotTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
})

function formatSnapshotTime(createdAt: string) {
  const date = new Date(createdAt)

  return Number.isNaN(date.getTime())
    ? createdAt
    : snapshotTimeFormatter.format(date)
}

export function DocumentSnapshotCard({
  archive,
  loadDetail,
  onRestore,
}: DocumentSnapshotCardProps) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] =
    useState<ConversationDocumentArchiveDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const createdAt = formatSnapshotTime(archive.createdAt)

  // 鼠标移到卡片上就开始取正文，点开时通常已经就绪；失败留给正式打开时再报错。
  function prefetchDetail() {
    if (detail) {
      return
    }

    void loadDetail(archive.id)
      .then(setDetail)
      .catch(() => undefined)
  }

  async function ensureDetail() {
    if (detail) {
      return
    }

    setDetailError(null)

    try {
      setDetail(await loadDetail(archive.id))
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "读取文档存档失败"
      )
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)

    if (nextOpen) {
      void ensureDetail()
    }
  }

  function handleRestore() {
    if (detail && onRestore(detail)) {
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div className="w-full max-w-sm p-px">
        <DialogTrigger
          render={<Card size="sm" className="w-full cursor-pointer" />}
          nativeButton={false}
          aria-label={`预览文档版本：${archive.title}`}
          onPointerEnter={prefetchDetail}
          onFocus={prefetchDetail}
        >
          <CardHeader className="grid-cols-[auto_minmax(0,1fr)] items-center">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate">{archive.title}</CardTitle>
              <CardDescription>创建时间：{createdAt}</CardDescription>
            </div>
          </CardHeader>
        </DialogTrigger>
      </div>

      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{archive.title}</DialogTitle>
          <DialogDescription>创建时间：{createdAt}</DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
          <ScrollArea className="h-[min(560px,calc(100vh-14rem))] rounded-xl border">
            <div className="px-6 py-5">
              {detail ? (
                <Streamdown>{detail.markdown}</Streamdown>
              ) : detailError ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-destructive">{detailError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void ensureDetail()}
                  >
                    重试
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3" aria-label="正在载入存档">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex justify-end">
            <Button type="button" onClick={handleRestore} disabled={!detail}>
              <RotateCcw data-icon="inline-start" />
              覆盖当前编辑器
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
