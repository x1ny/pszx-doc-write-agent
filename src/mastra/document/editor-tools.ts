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
  description: '将其他服务端工具已经生成好的完整 Markdown 内容写入用户当前打开的 Plate 编辑器。普通文章创作和整篇风格改写应使用 streamDocumentToPlate。',
  inputSchema: z.object({
    markdown: z.string().min(1).describe('完整文章的 Markdown 内容'),
  }),
  outputSchema: z.object({ success: z.boolean() }),
});

export const streamDocumentToPlate = createTool({
  id: 'streamDocumentToPlate',
  description:
    '在浏览器中启动真正的流式公文写入。用于创作新文章或整篇改写当前文档；只传写作要求和可选风格画像，不要在参数中生成或传入完整正文。',
  inputSchema: z.object({
    mode: z
      .enum(['create-document', 'replace-document'])
      .describe('创作新文档或整篇改写当前文档'),
    instruction: z
      .string()
      .min(1)
      .describe('完整、明确的写作要求；创作长文时应包含用户确认后的大纲'),
    styleProfile: z
      .string()
      .min(1)
      .optional()
      .describe('风格分析工作流返回的原始 styleProfile，未指定人物风格时不传'),
  }),
  outputSchema: z.object({ success: z.boolean() }),
});

export const getDocumentSnapshot = createTool({
  id: 'getDocumentSnapshot',
  description:
    '读取浏览器当前编辑器中的完整 Markdown 正文和文档结构。需要查找、修改、润色当前文档，或分析当前文档自身的写作风格时调用；指定人物的历史写作风格应先调用 workflow-buildStyleProfileWorkflow，本工具不负责生成或检索人物风格画像。',
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
