import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

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
});

const documentAnalysisSchema = z.object({
  subjectName: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  analysis: z.string().optional(),
  error: z.string().optional(),
});

const finalOutputSchema = z.object({ styleProfile: z.string().min(1) });

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
  execute: async ({ inputData }) => {
    const candidateMap = new Map(
      inputData.candidates.map((candidate) => [candidate.id, candidate])
    );

    return Promise.all(
      inputData.selectedDocumentIds.map(async (documentId) => {
        const candidate = candidateMap.get(documentId);
        if (!candidate) throw new Error(`找不到参考材料：${documentId}`);
        return {
          subjectName: inputData.subject.name,
          documentId,
          title: candidate.title,
          article: await readDocumentMaterialText(candidate.id),
        };
      })
    );
  },
});

const analyzeOneStyleReference = createStep({
  id: 'analyze-one-style-reference',
  inputSchema: loadedDocumentSchema,
  outputSchema: documentAnalysisSchema,
  execute: async ({ inputData, abortSignal }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return {
          subjectName: inputData.subjectName,
          documentId: inputData.documentId,
          title: inputData.title,
          status: 'succeeded' as const,
          analysis: await analyzeStyleProfile(inputData.article, { abortSignal }),
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      subjectName: inputData.subjectName,
      documentId: inputData.documentId,
      title: inputData.title,
      status: 'failed' as const,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  },
});

const synthesizeStyleReferences = createStep({
  id: 'synthesize-style-references',
  inputSchema: z.array(documentAnalysisSchema),
  outputSchema: finalOutputSchema,
  execute: async ({ inputData, abortSignal }) => {
    const successfulAnalyses = inputData
      .filter((result) => result.status === 'succeeded' && result.analysis)
      .map((result) => result.analysis as string);
    if (!successfulAnalyses.length) {
      throw new Error('所有参考材料的风格分析均未成功。');
    }

    return {
      styleProfile: await synthesizeStyleProfile(
        inputData[0].subjectName,
        successfulAnalyses,
        { abortSignal }
      ),
    };
  },
});

export const buildStyleProfileWorkflow = createWorkflow({
  id: 'build-style-profile-workflow',
  description:
    '根据指定人物或作者选择参考材料，逐篇分析并汇总为可迁移的 Markdown 写作风格总结。',
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
