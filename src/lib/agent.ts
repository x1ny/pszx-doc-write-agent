import type { UIMessage } from 'ai';

import type { ArticleOutline } from '@/lib/article-schema';
import type {
  DocumentBlock,
  LocalEdit,
} from '@/components/editor/document-editor-context';

type AssistantAgentUITools = {
  proposeArticleOutline: {
    input: ArticleOutline;
    output: ArticleOutline;
  };
  writeMarkdownToPlate: {
    input: { markdown: string };
    output: { success: boolean };
  };
  getDocumentSnapshot: {
    input: { query?: string };
    output: { blocks: DocumentBlock[] };
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
  getCurrentTime: {
    input: { timeZone?: string };
    output: { timeZone: string; currentTime: string };
  };
};

export type AssistantAgentUIMessage = UIMessage<
  unknown,
  never,
  AssistantAgentUITools
>;
