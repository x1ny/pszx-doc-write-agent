import { createAlibaba } from '@ai-sdk/alibaba';
import { Output, streamText } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { outlineSchema, type ArticleOutline } from '@/lib/article-schema';
import {
  DOCUMENT_TIME_ZONE,
  getCurrentDocumentDate,
} from '@/lib/current-date';

const alibaba = createAlibaba({
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL:
    process.env.DASHSCOPE_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
});

const generatedKeyPointPrefixPattern =
  /^(?:(?:G|gdp)[：:]?\s*(?=$|\p{Script=Han})|#{1,6}\s*|[-*+•●▪◦·]+\s*|(?:\d{1,2}|[一二三四五六七八九十]+)[、.．)）]\s*|[（(](?:\d{1,2}|[一二三四五六七八九十]+)[）)]\s*)+/u;

function normalizePlainText(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/^#{1,6}\s*/, '').trim();
}

function normalizeGeneratedKeyPoint(value: string) {
  return value.trim().replace(generatedKeyPointPrefixPattern, '').trim();
}

function normalizeOutlineProgress(value: unknown): ArticleOutline {
  const partial =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const partialSections = Array.isArray(partial.sections)
    ? partial.sections
    : [];

  return {
    title: normalizePlainText(partial.title),
    summary: normalizePlainText(partial.summary),
    sections: partialSections.map((section, index) => {
      const partialSection =
        typeof section === 'object' && section !== null
          ? (section as Record<string, unknown>)
          : {};
      const keyPoints = Array.isArray(partialSection.keyPoints)
        ? partialSection.keyPoints.filter(
            (point): point is string => typeof point === 'string'
          ).map(normalizeGeneratedKeyPoint).filter(Boolean)
        : [];

      return {
        id: `section-${index + 1}`,
        title: normalizePlainText(partialSection.title),
        purpose: normalizePlainText(partialSection.purpose),
        keyPoints,
      };
    }),
  };
}

export const proposeArticleOutline = createTool({
  id: 'proposeArticleOutline',
  description:
    '为较长公文生成与“一个主标题、若干一级章节、普通正文段落”对应的结构化大纲，展示给用户编辑并等待用户提交；在用户提交前不要生成全文。',
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
      return normalizeOutlineProgress(resumeData.outline);
    }

    const currentDate = getCurrentDocumentDate();
    const toolCallId = String(
      context.agent?.toolCallId ?? `outline-${Date.now()}`
    );
    const stream = streamText({
      model: alibaba(process.env.QWEN_MODEL || 'qwen3.6-flash'),
      system: `你是公文正文大纲规划助手。请根据用户需求生成结构清晰、内容具体、可直接用于后续正文生成的结构化大纲。

严格遵守：
1. 只生成符合给定 Schema 的大纲对象，不要生成正文，不要输出 Markdown、HTML、解释文字、代码块或额外字段。
2. title 是最终公文正文的唯一主标题，后续将一一对应 Markdown 的唯一 h1。这里只填写纯标题文本，不包含“#”、书名号或格式说明。
3. sections 只能是扁平的一级章节列表，不得设计子章节或多级标题。每个 sections[i] 后续必须按原顺序一一对应一个 h2。
4. 每个章节 title 使用“一、”“二、”“三、”等连续、规范的中文序号开头，只填写纯标题文本，不包含“##”或其他 Markdown 标记。
5. summary 是供后续全文生成使用的整体写作说明，只概括写作目标、主线和口径；它不是公文摘要，不得作为标题或独立正文段落输出。
6. purpose 和 keyPoints 只用于指导该章节生成普通正文段落。内容必须具体、可执行；后续不得把它们原样输出为标题或列表。
7. keyPoints 数组的每个元素本身就是一条要点，字符串必须直接从实际内容开始。严禁在元素开头添加“G”“gdp”、项目符号、Markdown 标记、数字序号、“要点1”等任何前缀。
8. 当前日期为 ${currentDate}（${DOCUMENT_TIME_ZONE}，北京时间）。涉及工作阶段或时间安排时，使用与当前日期一致、顺序合理的具体日期，或使用语义完整的相对时间；不得生成“X月X日”“XXXX”“待定”等占位符。
9. 大纲只规划主标题、一级章节与章节正文，不得包含份号、密级、紧急程度、发文字号、主送机关、发文机关署名、成文日期、附注、抄送机关、印发机关、印发日期等由表单维护的公文元数据。
10. 各章节之间不得重复或交叉堆砌，合在一起应完整覆盖用户要求；章节 id 依次使用 section-1、section-2、section-3 等稳定且唯一的值。`,
      prompt: description,
      abortSignal: context.abortSignal,
      output: Output.object({
        name: 'ArticleOutline',
        description: '与最终 h1、h2 和普通正文段落一一对应的结构化公文正文大纲',
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

    const output = normalizeOutlineProgress(await stream.output);
    await suspend?.({ outline: output });
  },
});
