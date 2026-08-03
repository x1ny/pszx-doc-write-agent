import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { ToolStream } from '@mastra/core/tools';
import { z } from 'zod';

import type {
  StyleProfileArticleProgress,
  StyleProfileProgressData,
  StyleProfileReportProgress,
  StyleProfileWorkflowProgress,
} from '@/lib/style-profile-progress';

import { observeStyleProfile, synthesizeStyleProfile } from './style-profile';
import { styleObservationSchema } from './style-observation';
import {
  documentMaterialSchema,
  getDocumentMaterials,
  readDocumentMaterialText,
} from './materials';

const subjectSchema = z.object({
  name: z.string().trim().min(1),
  organization: z.string().trim().min(1).optional(),
});

const workflowInputSchema = z.object({ subject: subjectSchema });

const searchOutputSchema = z.object({
  subject: subjectSchema,
  candidates: z.array(documentMaterialSchema).min(1),
  defaultSelectedDocumentIds: z.array(z.string()).min(1),
});

const selectionResumeSchema = z.object({
  selectedDocumentIds: z.array(z.string()).min(1),
  additionalCandidates: z.array(documentMaterialSchema).default([]),
});

const selectionSuspendSchema = z.object({
  type: z.literal('style-reference-selection'),
  subject: subjectSchema,
  candidates: z.array(documentMaterialSchema).min(1),
  defaultSelectedDocumentIds: z.array(z.string()).min(1),
});

const selectedOutputSchema = z.object({
  subject: subjectSchema,
  candidates: z.array(documentMaterialSchema).min(1),
  selectedDocumentIds: z.array(z.string()).min(1),
});

const loadedDocumentSchema = z.object({
  subjectName: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  date: z.string().min(1),
  article: z.string().min(1),
  position: z.number().int().positive(),
  totalCount: z.number().int().positive(),
});

const documentAnalysisSchema = z.object({
  subjectName: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  date: z.string().min(1),
  position: z.number().int().positive(),
  totalCount: z.number().int().positive(),
  status: z.enum(['succeeded', 'failed']),
  charCount: z.number().int().nonnegative().optional(),
  metricsText: z.string().optional(),
  observations: z.array(styleObservationSchema).optional(),
  error: z.string().optional(),
});

const finalOutputSchema = z.object({
  /** 用户可见的分析报告 */
  report: z.string().min(1),
  /** 写作模型消费的风格约束 */
  constraints: z.string().min(1),
});

const analysisProgressMessages = [
  '正在统计句长分布与指令表达密度',
  '正在观察开篇挂靠方式与收尾定性习惯',
  '正在辨析段落的判断、举措与责任落点',
  '正在采集引号凝练语与强动作动词',
  '正在核对数据呈现形态与例证来源',
  '正在校验每条观察的原文证据',
];

const synthesisProgressMessages = [
  '正在合并多篇材料中语义相同的写法',
  '正在按支持篇数核定证据强度',
  '正在分离稳定风格与单篇一次性写法',
  '正在生成风格总述与可执行的写作约束',
];

const progressTickDelayRange = {
  min: 1600,
  max: 3400,
} as const;

function getRandomProgressTickDelay() {
  const { min, max } = progressTickDelayRange;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getProgressPartId(progress: StyleProfileProgressData) {
  if (progress.kind === 'workflow') return `style-profile:${progress.runId}:workflow`;
  if (progress.kind === 'report') return `style-profile:${progress.runId}:report`;
  return `style-profile:${progress.runId}:article:${progress.article.documentId}`;
}

async function emitStyleProfileProgress(
  writer: ToolStream,
  progress: StyleProfileProgressData
) {
  // AI SDK 会用相同 type + id 原地更新 data part，避免每次提示都新增一张卡片。
  await writer.custom({
    type: 'data-style-profile-progress',
    id: getProgressPartId(progress),
    data: progress,
  });
}

async function emitWorkflowProgress(
  writer: ToolStream,
  progress: Omit<StyleProfileWorkflowProgress, 'state' | 'kind'>
) {
  await emitStyleProfileProgress(writer, {
    state: 'data-style-profile-progress',
    kind: 'workflow',
    ...progress,
  });
}

async function emitReportProgress(
  writer: ToolStream,
  progress: Omit<StyleProfileReportProgress, 'state' | 'kind'>
) {
  await emitStyleProfileProgress(writer, {
    state: 'data-style-profile-progress',
    kind: 'report',
    ...progress,
  });
}

async function emitArticleProgress(
  writer: ToolStream,
  progress: Omit<StyleProfileArticleProgress, 'state' | 'kind'>
) {
  await emitStyleProfileProgress(writer, {
    state: 'data-style-profile-progress',
    kind: 'article',
    ...progress,
  });
}

function waitForProgressTick(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timeout = setTimeout(finish, milliseconds);

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
  });
}

async function runWithProgressMessages<T>({
  operation,
  messages,
  onProgress,
}: {
  operation: Promise<T>;
  messages: string[];
  onProgress: (message: string) => Promise<void>;
}) {
  const progressController = new AbortController();
  const progressLoop = (async () => {
    let messageIndex = 0;

    while (!progressController.signal.aborted) {
      try {
        await waitForProgressTick(
          getRandomProgressTickDelay(),
          progressController.signal
        );
      } catch {
        return;
      }

      if (progressController.signal.aborted) return;

      await onProgress(
        messages[messageIndex % messages.length]
      );
      messageIndex += 1;
    }
  })();

  try {
    return await operation;
  } finally {
    progressController.abort();
    await progressLoop;
  }
}

const findStyleReferences = createStep({
  id: 'find-style-references',
  inputSchema: workflowInputSchema,
  outputSchema: searchOutputSchema,
  execute: async ({ inputData }) => {
    const candidates = await getDocumentMaterials();
    return {
      subject: inputData.subject,
      candidates,
      defaultSelectedDocumentIds: candidates.map((candidate) => candidate.id),
    };
  },
});

const selectStyleReferences = createStep({
  id: 'select-style-references',
  inputSchema: searchOutputSchema,
  outputSchema: selectedOutputSchema,
  suspendSchema: selectionSuspendSchema,
  resumeSchema: selectionResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return await suspend({
        type: 'style-reference-selection',
        subject: inputData.subject,
        candidates: inputData.candidates,
        defaultSelectedDocumentIds: inputData.defaultSelectedDocumentIds,
      });
    }

    const candidates = [
      ...inputData.candidates,
      ...resumeData.additionalCandidates.filter(
        (candidate) =>
          !inputData.candidates.some((existing) => existing.id === candidate.id)
      ),
    ];
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const selectedDocumentIds = [...new Set(resumeData.selectedDocumentIds)].filter((id) =>
      candidateIds.has(id)
    );
    if (!selectedDocumentIds.length) {
      throw new Error('至少需要选择一份参考材料。');
    }

    return {
      subject: inputData.subject,
      candidates,
      selectedDocumentIds,
    };
  },
});

const loadStyleReferences = createStep({
  id: 'load-style-references',
  inputSchema: selectedOutputSchema,
  outputSchema: z.array(loadedDocumentSchema),
  execute: async ({ inputData, runId, writer }) => {
    const candidateMap = new Map(
      inputData.candidates.map((candidate) => [candidate.id, candidate])
    );
    const totalCount = inputData.selectedDocumentIds.length;

    await emitWorkflowProgress(writer, {
      runId,
      subjectName: inputData.subject.name,
      phase: 'loading',
      totalCount,
      message: `正在读取 ${totalCount} 篇参考文章并准备分析`,
    });

    const loadedDocuments = await Promise.all(
      inputData.selectedDocumentIds.map(async (documentId, index) => {
        const candidate = candidateMap.get(documentId);
        if (!candidate) throw new Error(`找不到参考材料：${documentId}`);
        return {
          subjectName: inputData.subject.name,
          documentId,
          title: candidate.title,
          // date 决定跨篇定档时“近期渐强”的判定，缺失时退回标题排序。
          date: candidate.date || candidate.title,
          article: await readDocumentMaterialText(candidate.id),
          position: index + 1,
          totalCount,
        };
      })
    );

    for (const document of loadedDocuments) {
      await emitArticleProgress(writer, {
        runId,
        subjectName: document.subjectName,
        totalCount,
        article: {
          documentId: document.documentId,
          title: document.title,
          position: document.position,
          status: 'queued',
          detail: '正文已读取，等待进入分析队列',
        },
      });
    }

    await emitWorkflowProgress(writer, {
      runId,
      subjectName: inputData.subject.name,
      phase: 'analyzing',
      totalCount,
      message: `已读取 ${totalCount} 篇文章，正在并发提取写作特征`,
    });

    return loadedDocuments;
  },
});

const analyzeOneStyleReference = createStep({
  id: 'analyze-one-style-reference',
  inputSchema: loadedDocumentSchema,
  outputSchema: documentAnalysisSchema,
  execute: async ({ inputData, abortSignal, runId, writer }) => {
    let lastError: unknown;

    const reportArticleProgress = async (
      status: StyleProfileArticleProgress['article']['status'],
      detail: string
    ) => {
      await emitArticleProgress(writer, {
        runId,
        subjectName: inputData.subjectName,
        totalCount: inputData.totalCount,
        article: {
          documentId: inputData.documentId,
          title: inputData.title,
          position: inputData.position,
          status,
          detail,
        },
      });
    };

    await reportArticleProgress('analyzing', '正在建立文章结构与语言特征索引');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const outcome = await runWithProgressMessages({
          operation: observeStyleProfile(inputData.article, { abortSignal }),
          messages: analysisProgressMessages,
          onProgress: (message) => reportArticleProgress('analyzing', message),
        });

        // 证据校验和跨文种筛选都可能清空结果，这时这篇不能算成功，
        // 否则汇总阶段会拿着空观察去凑数。
        if (!outcome.observations.length) {
          throw new Error('本篇没有通过证据校验的可迁移观察。');
        }

        const discarded = outcome.dropped.length + outcome.documentSpecificCount;
        await reportArticleProgress(
          'completed',
          discarded > 0
            ? `已确认 ${outcome.observations.length} 条可迁移特征，剔除 ${discarded} 条证据不足或随文种变化的记录`
            : `已确认 ${outcome.observations.length} 条可迁移特征`
        );

        return {
          subjectName: inputData.subjectName,
          documentId: inputData.documentId,
          title: inputData.title,
          date: inputData.date,
          position: inputData.position,
          totalCount: inputData.totalCount,
          status: 'succeeded' as const,
          charCount: outcome.charCount,
          metricsText: outcome.metricsText,
          observations: outcome.observations,
        };
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await reportArticleProgress(
            'analyzing',
            '首轮分析未完成，正在重新分析这篇文章'
          );
        }
      }
    }

    await reportArticleProgress('failed', '两次分析均未完成，汇总时将跳过这篇文章');

    return {
      subjectName: inputData.subjectName,
      documentId: inputData.documentId,
      title: inputData.title,
      date: inputData.date,
      position: inputData.position,
      totalCount: inputData.totalCount,
      status: 'failed' as const,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  },
});

const synthesizeStyleReferences = createStep({
  id: 'synthesize-style-references',
  inputSchema: z.array(documentAnalysisSchema),
  outputSchema: finalOutputSchema,
  execute: async ({ inputData, abortSignal, runId, writer }) => {
    const bundles = inputData
      .filter((result) => result.status === 'succeeded' && result.observations?.length)
      .map((result) => ({
        documentId: result.documentId,
        title: result.title,
        date: result.date,
        charCount: result.charCount ?? 0,
        metricsText: result.metricsText ?? '',
        observations: result.observations ?? [],
      }));
    const subjectName = inputData[0]?.subjectName ?? '目标人物';
    const totalCount = inputData[0]?.totalCount ?? inputData.length;

    if (!bundles.length) {
      await emitWorkflowProgress(writer, {
        runId,
        subjectName,
        phase: 'failed',
        totalCount,
        message: '所选文章均未能完成分析，无法生成写作风格画像',
      });
      throw new Error('所有参考材料的风格分析均未成功。');
    }

    await emitWorkflowProgress(writer, {
      runId,
      subjectName,
      phase: 'synthesizing',
      totalCount,
      message: `逐篇分析已结束，正在汇总 ${bundles.length} 篇有效结果`,
    });

    try {
      const { report, constraints, profile } = await runWithProgressMessages({
        operation: synthesizeStyleProfile({ subjectName, bundles }, { abortSignal }),
        messages: synthesisProgressMessages,
        onProgress: (message) =>
          emitWorkflowProgress(writer, {
            runId,
            subjectName,
            phase: 'synthesizing',
            totalCount,
            message,
          }),
      });

      await emitWorkflowProgress(writer, {
        runId,
        subjectName,
        phase: 'completed',
        totalCount,
        message: `写作风格分析报告已生成，采用 ${bundles.length} 篇材料，确认 ${profile.features.length} 项稳定特征`,
      });

      const dates = profile.documents.map((document) => document.date);
      const isSingleDocument = profile.documents.length <= 1;
      await emitReportProgress(writer, {
        runId,
        subjectName,
        totalCount,
        documentCount: profile.documents.length,
        charCount: profile.documents.reduce(
          (sum, document) => sum + document.charCount,
          0
        ),
        range: isSingleDocument
          ? profile.documents[0]?.title || '单篇材料'
          : `${dates[0]}—${dates[dates.length - 1]}`,
        isSingleDocument,
        features: profile.features.map(({ dimension, claim, detail, band }) => ({
          dimension,
          claim,
          detail,
          band,
        })),
        incidental: profile.incidental.map((feature) => feature.claim),
        overview: profile.overview,
        maxim: profile.maxim,
      });

      return { report, constraints };
    } catch (error) {
      await emitWorkflowProgress(writer, {
        runId,
        subjectName,
        phase: 'failed',
        totalCount,
        message: '逐篇分析已完成，但汇总写作风格画像时发生错误',
      });
      throw error;
    }
  },
});

export const buildStyleProfileWorkflow = createWorkflow({
  id: 'build-style-profile-workflow',
  description:
    '当用户明确指定某位领导、作者或其他人物，要求分析、学习或模仿其写作风格，或按其风格改写文档时调用。工作流会检索该人物的参考文章、等待用户选择材料、逐篇观察并汇总，返回两份结果：report 是给用户看的写作风格分析报告，constraints 是给写作模型执行的风格约束；不要用当前待改写文档代替人物参考材料。',
  inputSchema: workflowInputSchema,
  outputSchema: finalOutputSchema,
})
  .then(findStyleReferences)
  .then(selectStyleReferences)
  .then(loadStyleReferences)
  .foreach(analyzeOneStyleReference, { concurrency: 8 })
  .then(synthesizeStyleReferences)
  .commit();

export type BuildStyleProfileInput = z.infer<typeof workflowInputSchema>;
export type StyleReferenceSelectionPayload = z.infer<typeof selectionSuspendSchema>;
