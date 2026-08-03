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
  StyleProfileReportProgress,
  StyleProfileWorkflowProgress,
} from "@/lib/style-profile-progress"

const DIMENSION_ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八"]

function formatScale(documentCount: number, charCount: number) {
  const inTenThousands = charCount / 10000
  const size =
    inTenThousands >= 1
      ? `约 ${inTenThousands.toFixed(1)} 万字`
      : `约 ${charCount} 字`
  return `${documentCount} 篇，${size}`
}

/** 画像正文卡片。排版在这里做，不让模型把报告复述进聊天文本。 */
function StyleProfileReport({ report }: { report: StyleProfileReportProgress }) {
  return (
    <Card
      size="sm"
      className="mt-3 min-w-[600px] max-w-2xl self-start border border-border ring-0"
    >
      <CardHeader className="gap-1">
        <CardTitle className="text-[18px]!">写作风格分析报告</CardTitle>
        <CardDescription className="flex flex-col gap-0.5 text-xs">
          <span>分析对象　{report.subjectName}</span>
          <span>材料范围　{report.range}</span>
          <span>
            材料规模　{formatScale(report.documentCount, report.charCount)}
          </span>
          {report.isSingleDocument && (
            <span>分析说明　单篇分析，未做跨篇稳定性验证</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 border-t border-border pt-4 text-sm">
        {report.features.map((feature, index) => (
          <div key={`${feature.dimension}-${index}`} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium">
                {DIMENSION_ORDINALS[index] ?? index + 1}、{feature.dimension}：
                {feature.claim}
              </span>
              {feature.band && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {feature.band}
                </span>
              )}
            </div>
            <p className="text-muted-foreground leading-relaxed">{feature.detail}</p>
          </div>
        ))}

        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="font-medium">风格总述</span>
          <p className="text-muted-foreground leading-relaxed">{report.overview}</p>
        </div>

        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">风格要诀</span>
          <span className="text-muted-foreground">{report.maxim}</span>
        </div>

        {report.incidental.length > 0 && (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground italic">
            附：偶发特征（不计入稳定风格）——{report.incidental.join("；")}。
          </p>
        )}
      </CardContent>
    </Card>
  )
}

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
  let report: StyleProfileReportProgress | undefined
  const articlesById = new Map<string, StyleProfileArticleProgress>()

  for (const event of events) {
    if (event.kind === "workflow") {
      workflowProgress = event
      continue
    }

    if (event.kind === "report") {
      report = event
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
    <div className="order-first flex flex-col">
    <Card
      size="sm"
      className="mt-4 min-w-[600px] max-w-2xl self-start border border-border ring-0"
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
                </span>
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
    {report && <StyleProfileReport report={report} />}
    </div>
  )
}
