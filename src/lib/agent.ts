import type { UIMessage } from 'ai';

import type { ArticleOutline } from '@/lib/article-schema';
import type {
  DocumentBlock,
  LocalEdit,
} from '@/components/editor/document-editor-context';

type AssistantAgentUITools = {
  proposeArticleOutline: {
    input: { description: string };
    output: ArticleOutline;
  };
  simulateLeaderStyleAnalysis: {
    input: { leaderName: string };
    output: {
      leaderName: string;
      materialCount: number;
      styleSummary: string;
      styleFeatures: string[];
      rewriteGuidance: string[];
    };
  };
  writeMarkdownToPlate: {
    input: { markdown: string };
    output: { success: boolean };
  };
  getDocumentSnapshot: {
    input: { query?: string };
    output: { blocks: DocumentBlock[]; markdown?: string };
  };
  applyLocalEdit: {
    input: LocalEdit;
    output: { success: boolean; message?: string };
  };
  verifyKnowledgeBase: {
    input: { question: string };
    output: {
      question: string;
      verified: boolean;
      instruction: string;
      answer: string;
    };
  };
  simulateDocumentDataRefresh: {
    input: { documentMarkdown: string; targetYear: string };
    output: {
      targetYear: string;
      updatedMarkdown: string;
      replacements: Array<{
        original: string;
        replacement: string;
        reason: string;
      }>;
      summary: string;
    };
  };
  getCurrentTime: {
    input: { timeZone?: string };
    output: { timeZone: string; currentTime: string };
  };
};

type AssistantAgentUIData = {
  "tool-call-suspended": {
    state: "data-tool-call-suspended";
    runId: string;
    toolCallId: string;
    toolName: string;
    suspendPayload: { outline: ArticleOutline };
    resumeSchema?: unknown;
  };
  "style-rewrite-progress": {
    state: "data-style-rewrite-progress";
    toolCallId: string;
    phase: "searching" | "found" | "summarizing";
    leaderName: string;
    materialCount: number;
    message: string;
  };
  "style-rewrite-result": {
    state: "data-style-rewrite-result";
    toolCallId: string;
    output: {
      leaderName: string;
      materialCount: number;
      styleSummary: string;
      styleFeatures: string[];
      rewriteGuidance: string[];
    };
  };
  "document-data-refresh-progress": {
    state: "data-document-data-refresh-progress";
    toolCallId: string;
    phase: "searching" | "found" | "updating";
    targetYear: string;
    replacementCount: number;
    message: string;
  };
  "document-data-refresh-result": {
    state: "data-document-data-refresh-result";
    toolCallId: string;
    output: {
      targetYear: string;
      updatedMarkdown: string;
      replacements: Array<{
        original: string;
        replacement: string;
        reason: string;
      }>;
      summary: string;
    };
  };
};

export type AssistantAgentUIMessage = UIMessage<
  unknown,
  AssistantAgentUIData,
  AssistantAgentUITools
>;
