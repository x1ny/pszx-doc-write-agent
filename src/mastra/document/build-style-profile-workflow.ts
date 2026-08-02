import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { ToolStream } from '@mastra/core/tools';
import { z } from 'zod';

import type {
  StyleProfileArticleProgress,
  StyleProfileProgressData,
  StyleProfileWorkflowProgress,
} from '@/lib/style-profile-progress';

import { analyzeStyleProfile, synthesizeStyleProfile } from './style-profile';
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
  article: z.string().min(1),
  position: z.number().int().positive(),
  totalCount: z.number().int().positive(),
});

const documentAnalysisSchema = z.object({
  subjectName: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  position: z.number().int().positive(),
  totalCount: z.number().int().positive(),
  status: z.enum(['succeeded', 'failed']),
  analysis: z.string().optional(),
  error: z.string().optional(),
});

const finalOutputSchema = z.object({ styleProfile: z.string().min(1) });

const analysisProgressMessages = [
  '正在识别篇章结构和标题层级',
  '正在提取高频句式与段落节奏',
  '正在归纳数据、案例和任务部署的表达方式',
  '正在辨析判断句、过渡句和号召句的使用习惯',
  '正在核对用词偏好与公文表达强度',
  '正在筛选可迁移、可复用的稳定风格特征',
];

const synthesisProgressMessages = [
  '正在对齐多篇文章中的共同写作特征',
  '正在区分稳定风格与单篇主题造成的偶然表达',
  '正在合并结构、句式、用词和论证方式',
  '正在整理可直接用于改写的风格约束',
];

function getProgressPartId(progress: StyleProfileProgressData) {
  return progress.kind === 'workflow'
    ? `style-profile:${progress.runId}:workflow`
    : `style-profile:${progress.runId}:article:${progress.article.documentId}`;
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
  onProgress: (message: string, elapsedSeconds: number) => Promise<void>;
}) {
  const progressController = new AbortController();
  const startedAt = Date.now();
  const progressLoop = (async () => {
    let messageIndex = 0;

    while (!progressController.signal.aborted) {
      try {
        await waitForProgressTick(2200, progressController.signal);
      } catch {
        return;
      }

      if (progressController.signal.aborted) return;

      await onProgress(
        messages[messageIndex % messages.length],
        Math.max(1, Math.round((Date.now() - startedAt) / 1000))
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
      detail: string,
      elapsedSeconds?: number
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
          elapsedSeconds,
        },
      });
    };

    await reportArticleProgress('analyzing', '正在建立文章结构与语言特征索引');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const analysis = await runWithProgressMessages({
          operation: analyzeStyleProfile(inputData.article, { abortSignal }),
          messages: analysisProgressMessages,
          onProgress: (message, elapsedSeconds) =>
            reportArticleProgress('analyzing', message, elapsedSeconds),
        });

        await reportArticleProgress('completed', '分析完成，已提取可迁移的风格特征');

        return {
          subjectName: inputData.subjectName,
          documentId: inputData.documentId,
          title: inputData.title,
          position: inputData.position,
          totalCount: inputData.totalCount,
          status: 'succeeded' as const,
          analysis,
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
    const successfulAnalyses = inputData
      .filter((result) => result.status === 'succeeded' && result.analysis)
      .map((result) => result.analysis as string);
    const subjectName = inputData[0]?.subjectName ?? '目标人物';
    const totalCount = inputData[0]?.totalCount ?? inputData.length;

    if (!successfulAnalyses.length) {
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
      message: `逐篇分析已结束，正在汇总 ${successfulAnalyses.length} 篇有效结果`,
    });

    try {
      const styleProfile = await runWithProgressMessages({
        operation: synthesizeStyleProfile(subjectName, successfulAnalyses, {
          abortSignal,
        }),
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
        message: `写作风格画像已生成，共采用 ${successfulAnalyses.length} 篇文章的分析结果`,
      });

      return { styleProfile };
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
    '当用户明确指定某位领导、作者或其他人物，要求分析、学习或模仿其写作风格，或按其风格改写文档时调用。工作流会检索该人物的参考文章、等待用户选择材料、逐篇分析并汇总为可迁移的 Markdown Style Profile；不要用当前待改写文档代替人物参考材料。',
  inputSchema: workflowInputSchema,
  outputSchema: finalOutputSchema,
})
  .then(findStyleReferences)
  .then(selectStyleReferences)
  .then(loadStyleReferences)
  .foreach(analyzeOneStyleReference, { concurrency: 3 })
  .then(synthesizeStyleReferences)
  .commit();

export type BuildStyleProfileInput = z.infer<typeof workflowInputSchema>;
export type StyleReferenceSelectionPayload = z.infer<typeof selectionSuspendSchema>;
