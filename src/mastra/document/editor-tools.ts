import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const documentBlockSchema = z.object({
  path: z.array(z.number()),
  type: z.string(),
  text: z.string(),
});

export const documentSnapshotSchema = z.object({
  blocks: z.array(documentBlockSchema),
  markdown: z.string().optional(),
});

const localEditSchema = z.object({
  path: z.array(z.number()).min(1),
  expectedText: z.string().min(1),
  targetText: z.string().min(1),
  replacement: z.string().min(1),
});

export const writeMarkdownToPlate = createTool({
  id: 'writeMarkdownToPlate',
  description: '将已经完成的完整公文 Markdown 内容写入用户当前打开的 Plate 编辑器。',
  inputSchema: z.object({
    markdown: z.string().min(1).describe('完整文章的 Markdown 内容'),
  }),
  outputSchema: z.object({ success: z.boolean() }),
});

export const getDocumentSnapshot = createTool({
  id: 'getDocumentSnapshot',
  description:
    '读取当前 Plate 编辑器的完整 Markdown 正文和文档结构。修改、润色或风格分析前必须先调用。',
  inputSchema: z.object({
    query: z.string().optional().describe('可选的检索关键词'),
  }),
  outputSchema: documentSnapshotSchema,
});

export const applyLocalEdit = createTool({
  id: 'applyLocalEdit',
  description: '基于文档快照对当前文档中的一个段落执行局部替换。expectedText 必须来自最新快照。',
  inputSchema: localEditSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
  }),
});
