export type StyleProfileWorkflowPhase =
  | "loading"
  | "analyzing"
  | "synthesizing"
  | "completed"
  | "failed"

export type StyleProfileArticleStatus =
  | "queued"
  | "analyzing"
  | "completed"
  | "failed"

type StyleProfileProgressBase = {
  state: "data-style-profile-progress"
  runId: string
  subjectName: string
  totalCount: number
}

export type StyleProfileWorkflowProgress = StyleProfileProgressBase & {
  kind: "workflow"
  phase: StyleProfileWorkflowPhase
  message: string
}

export type StyleProfileArticleProgress = StyleProfileProgressBase & {
  kind: "article"
  article: {
    documentId: string
    title: string
    position: number
    status: StyleProfileArticleStatus
    detail: string
  }
}

export type StyleProfileReportFeature = {
  dimension: string
  claim: string
  detail: string
  /** 证据强度标签，单篇分析时为空 */
  band: string | null
}

/**
 * 分析完成后随流下发的画像正文。
 *
 * 走进度通道而不是让模型把报告复述进聊天文本：
 * 排版是代码渲染的，模型复述一遍既慢又会改动措辞。
 */
export type StyleProfileReportProgress = StyleProfileProgressBase & {
  kind: "report"
  documentCount: number
  charCount: number
  /** 材料年份范围，单篇时为材料标题 */
  range: string
  isSingleDocument: boolean
  features: StyleProfileReportFeature[]
  incidental: string[]
  overview: string
  maxim: string
}

export type StyleProfileProgressData =
  | StyleProfileWorkflowProgress
  | StyleProfileArticleProgress
  | StyleProfileReportProgress
