import { createAlibaba } from '@ai-sdk/alibaba';
import { Output, streamText } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { outlineSchema, type ArticleOutline } from '@/lib/article-schema';

const alibaba = createAlibaba({
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL:
    process.env.DASHSCOPE_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
});

function normalizeOutlineProgress(value: unknown): ArticleOutline {
  const partial =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const partialSections = Array.isArray(partial.sections)
    ? partial.sections
    : [];

  return {
    title: typeof partial.title === 'string' ? partial.title : '',
    summary: typeof partial.summary === 'string' ? partial.summary : '',
    sections: partialSections.map((section, index) => {
      const partialSection =
        typeof section === 'object' && section !== null
          ? (section as Record<string, unknown>)
          : {};
      const keyPoints = Array.isArray(partialSection.keyPoints)
        ? partialSection.keyPoints.filter(
            (point): point is string => typeof point === 'string'
          )
        : [];

      return {
        id:
          typeof partialSection.id === 'string' && partialSection.id
            ? partialSection.id
            : `section-${index + 1}`,
        title:
          typeof partialSection.title === 'string'
            ? partialSection.title
            : '',
        purpose:
          typeof partialSection.purpose === 'string'
            ? partialSection.purpose
            : '',
        keyPoints,
      };
    }),
  };
}

export const proposeArticleOutline = createTool({
  id: 'proposeArticleOutline',
  description:
    '为较长公文生成结构化文章大纲，展示给用户编辑并等待用户提交编辑后的大纲；在用户提交前不要生成全文。',
  inputSchema: z.object({
    description: z.string().min(1).describe('用户希望创作的公文主题、目标和重点要求'),
  }),
  outputSchema: outlineSchema,
  suspendSchema: z.object({
    outline: outlineSchema,
  }),
  resumeSchema: z.object({
    outline: outlineSchema,
  }),
  execute: async ({ description }, context) => {
    const { resumeData, suspend } = context.agent ?? {};

    if (resumeData?.outline) {
      return resumeData.outline;
    }

    const toolCallId = String(
      context.agent?.toolCallId ?? `outline-${Date.now()}`
    );
    const stream = streamText({
      model: alibaba(process.env.QWEN_MODEL || 'qwen3.6-flash'),
      system:
        '你是公文写作规划助手。请根据用户需求生成结构清晰、内容具体的公文大纲。只输出符合给定结构的大纲对象，不要输出 Markdown、解释文字或代码块。大纲应包含标题、摘要和多个章节，每个章节包含写作目的和关键要点。',
      prompt: description,
      abortSignal: context.abortSignal,
      output: Output.object({
        name: 'ArticleOutline',
        description: '结构化公文文章大纲',
        schema: outlineSchema,
      }),
      providerOptions: {
        alibaba: {
          enableThinking: false,
        },
      },
    });

    for await (const partial of stream.partialOutputStream) {
      await context.writer?.custom({
        type: 'data-outline-progress',
        data: {
          state: 'data-outline-progress',
          toolCallId,
          outline: normalizeOutlineProgress(partial),
        },
        transient: true,
      });
    }

    const output = await stream.output;
    await suspend?.({ outline: output });
  },
});
