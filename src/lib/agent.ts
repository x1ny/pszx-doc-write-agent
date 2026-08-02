import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai';

import type { DocumentMaterial } from '@/lib/document-material';
import type { ArticleOutline } from '@/lib/article-schema';
import type {
  DocumentBlock,
  LocalEdit,
} from '@/components/editor/document-editor-context';

type AssistantAgentUITools = {
  "workflow-buildStyleProfileWorkflow": {
    input: {
      subject: { name: string; organization?: string };
    };
    output: { styleProfile: string };
  };
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
  streamDocumentToPlate: {
    input: {
      mode: "create-document" | "replace-document";
      instruction: string;
      styleProfile?: string;
    };
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
  "outline-progress": {
    state: "data-outline-progress";
    toolCallId: string;
    outline: ArticleOutline;
  };
  "tool-call-suspended": {
    state: "data-tool-call-suspended";
    runId: string;
    toolCallId: string;
    toolName: string;
    suspendPayload: {
      outline?: ArticleOutline;
      type?: "style-reference-selection";
      subject?: { name: string; organization?: string };
      candidates?: DocumentMaterial[];
      defaultSelectedDocumentIds?: string[];
    };
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

/**
 * 工具调用后模型已经给出正文时，不再为同一结果额外续传一轮。
 * 工具之前的说明文字不影响续传，只有工具之后的文字才视为本轮已回答。
 */
export function shouldContinueAfterToolCalls({
  messages,
}: {
  messages: AssistantAgentUIMessage[];
}) {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) {
    return false;
  }

  const lastMessage = messages.at(-1);

  if (!lastMessage || lastMessage.role !== 'assistant') {
    return false;
  }

  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) =>
      part.type === 'step-start' ? index : lastIndex,
    -1
  );
  const lastStepParts = lastMessage.parts.slice(lastStepStartIndex + 1);
  let lastToolIndex = -1;

  lastStepParts.forEach((part, index) => {
    if (isToolUIPart(part) && !part.providerExecuted) {
      lastToolIndex = index;
    }
  });

  return !lastStepParts.slice(lastToolIndex + 1).some(
    (part) => part.type === 'text' && part.text.trim().length > 0
  );
}
