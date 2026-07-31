import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { styleProfileSystemPrompt } from './style-profile-prompt';

/**
 * 根据公文原文提取可以迁移到后续写作中的 Style Profile。
 *
 * 这是风格分析的唯一模型调用入口，命令行脚本和 agent tool 都复用它，
 * 避免两处提示词、模型配置和输出约束逐渐产生差异。
 */
export async function analyzeStyleProfile(
  article: string,
  options: { abortSignal?: AbortSignal } = {}
) {
  const normalizedArticle = article.trim();
  if (!normalizedArticle) {
    throw new Error('待分析的文章内容不能为空。');
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      '未找到 DEEPSEEK_API_KEY，请先在 .env.local 中配置模型访问密钥。'
    );
  }

  const deepseek = createDeepSeek({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || undefined,
  });

  const result = await generateText({
    model: deepseek(process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    system: styleProfileSystemPrompt,
    prompt: `请分析以下待分析文章，并严格按照系统提示词输出 Style Profile。

--- 待分析文章开始 ---
${normalizedArticle}
--- 待分析文章结束 ---`,
    maxOutputTokens: 12000,
    abortSignal: options.abortSignal,
    providerOptions: {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    },
  });

  return result.text.trim();
}

const styleProfileOutputSchema = z.object({
  styleProfile: z.string().min(1),
  articleLength: z.number().int().positive(),
});

/** Agent 使用的当前文章风格分析工具。调用前应先获取最新文档快照。 */
export const analyzeStyleProfileTool = createTool({
  id: 'analyzeStyleProfile',
  description:
    '根据输入的完整公文 Markdown 提取可迁移的 Style Profile，用于指导后续写作。只分析输入文章，不修改文档或工作记忆。',
  inputSchema: z.object({
    article: z.string().min(1).describe('待分析的完整公文 Markdown 内容'),
  }),
  outputSchema: styleProfileOutputSchema,
  execute: async ({ article }, context) => ({
    styleProfile: await analyzeStyleProfile(article, {
      abortSignal: context.abortSignal,
    }),
    articleLength: article.trim().length,
  }),
});
