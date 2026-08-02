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

export type StyleProfileProgressData =
  | StyleProfileWorkflowProgress
  | StyleProfileArticleProgress
