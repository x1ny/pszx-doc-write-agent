import {
  Circle,
  CircleCheck,
  CircleX,
  Loader2,
} from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type {
  StyleProfileArticleProgress,
  StyleProfileProgressData,
  StyleProfileWorkflowProgress,
} from "@/lib/style-profile-progress"

type StyleProfileProgressProps = {
  events: StyleProfileProgressData[]
}

function getStatusLabel(
  status: StyleProfileArticleProgress["article"]["status"]
) {
  switch (status) {
    case "queued":
      return "等待分析"
    case "analyzing":
      return "分析中"
    case "completed":
      return "已完成"
    case "failed":
      return "分析失败"
  }
}

function ArticleStatusIcon({
  status,
}: {
  status: StyleProfileArticleProgress["article"]["status"]
}) {
  if (status === "analyzing") {
    return <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
  }

  if (status === "completed") {
    return <CircleCheck className="size-4 text-primary" aria-hidden="true" />
  }

  if (status === "failed") {
    return <CircleX className="size-4 text-destructive" aria-hidden="true" />
  }

  return <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
}

function getCardTitle(progress: StyleProfileWorkflowProgress) {
  switch (progress.phase) {
    case "loading":
      return `正在准备${progress.subjectName}的风格分析`
    case "analyzing":
      return `正在分析${progress.subjectName}的写作风格`
    case "synthesizing":
      return `正在汇总${progress.subjectName}的写作风格`
    case "completed":
      return `${progress.subjectName}的写作风格画像已生成`
    case "failed":
      return `${progress.subjectName}的写作风格分析未完成`
  }
}

export function StyleProfileProgress({ events }: StyleProfileProgressProps) {
  let workflowProgress: StyleProfileWorkflowProgress | undefined
  const articlesById = new Map<string, StyleProfileArticleProgress>()

  for (const event of events) {
    if (event.kind === "workflow") {
      workflowProgress = event
      continue
    }

    articlesById.set(event.article.documentId, event)
  }

  if (!workflowProgress) return null

  const articles = [...articlesById.values()].sort(
    (left, right) => left.article.position - right.article.position
  )
  const processedCount = articles.filter(
    ({ article }) =>
      article.status === "completed" || article.status === "failed"
  ).length
  const isRunning =
    workflowProgress.phase !== "completed" && workflowProgress.phase !== "failed"

  return (
    <Card
      size="sm"
      className="order-first mt-4 min-w-[600px] max-w-2xl self-start border border-border ring-0"
    >
      <CardHeader>
        <CardTitle className="text-[16px]!">{getCardTitle(workflowProgress)}</CardTitle>
        <CardDescription
          aria-live="polite"
          className={cn(isRunning && "shimmer")}
        >
          {workflowProgress.message}
        </CardDescription>
        <CardAction className="text-xs tabular-nums text-muted-foreground">
          已处理 {processedCount}/{workflowProgress.totalCount}
        </CardAction>
      </CardHeader>
      {articles.length > 0 && (
        <CardContent className="flex flex-col gap-3">
          {articles.map(({ article }) => (
            <div
              key={article.documentId}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2"
            >
              <span className="mt-1.5">
                <ArticleStatusIcon status={article.status} />
                <span className="sr-only">{getStatusLabel(article.status)}</span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">
                  {article.position}. {article.title}
                </span>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    article.status === "analyzing" && "shimmer"
                  )}
                >
                  {article.detail}
                  {article.status === "analyzing" && article.elapsedSeconds
                    ? ` · 已用时 ${article.elapsedSeconds} 秒`
                    : ""}
                </span>
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
