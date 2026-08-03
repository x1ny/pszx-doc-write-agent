import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject, generateText } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  buildStyleObservationPrompt,
  styleObservationSystemPrompt,
} from './style-profile-prompt';
import {
  buildStyleSynthesisPrompt,
  styleSynthesisSystemPrompt,
} from './style-profile-synthesis-prompt';
import {
  bandStyleFeatures,
  collectEvidencePool,
  keepTransferableObservations,
  sanitizeUnsupportedQuotes,
  styleObservationResultSchema,
  styleSynthesisResultSchema,
  verifyObservations,
  type StyleDocumentRef,
  type StyleObservation,
  type StyleProfileData,
} from './style-observation';
import {
  formatStyleMetrics,
  measureStyleMetrics,
  sampleArticle,
} from './style-metrics';
import { renderStyleConstraints, renderStyleReport } from './style-profile-render';

function createStyleProfileModel() {
  const apiKey = (
    process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY
  )?.trim();
  if (!apiKey) {
    throw new Error(
      '未找到 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY，请先在 .env.local 中配置模型访问密钥。'
    );
  }

  const alibaba = createAlibaba({
    apiKey,
    baseURL:
      process.env.DASHSCOPE_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
  });

  return alibaba(process.env.QWEN_MODEL || 'qwen3.6-flash');
}

const providerOptions = { alibaba: { enableThinking: false } } as const;

/** 从可能带围栏或前后缀说明的模型输出里抠出 JSON 主体。 */
function extractJson(text: string) {
  const withoutFence = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型输出中没有找到 JSON 对象。');
  }
  return withoutFence.slice(start, end + 1);
}

/**
 * 结构化生成，附一次文本回退。
 *
 * 部分模型端点对原生结构化输出的支持并不稳定，
 * 回退到“文本 + 严格 JSON 约束 + 自行解析”可以救回大部分失败，
 * 且最终仍由同一个 schema 校验，不会放松数据契约。
 */
async function generateStructured<T>({
  schema,
  system,
  prompt,
  abortSignal,
}: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const model = createStyleProfileModel();

  try {
    const { object } = await generateObject({
      model,
      schema,
      system,
      prompt,
      maxOutputTokens: 4000,
      abortSignal,
      providerOptions,
    });
    return object as T;
  } catch (error) {
    if (abortSignal?.aborted) throw error;

    const { text } = await generateText({
      model,
      system: `${system}\n\n只输出一个 JSON 对象，不要使用代码块，不要输出任何解释文字。`,
      prompt,
      maxOutputTokens: 4000,
      abortSignal,
      providerOptions,
    });
    return schema.parse(JSON.parse(extractJson(text)));
  }
}

const VERBATIM_EVIDENCE_REMINDER = `注意：上一轮输出的 evidence 无法在正文中检索到，已全部作废。
evidence 必须是从正文中**逐字复制**的连续片段，不得改写、缩写、拼接或概括，也不要自行补充标点。
复制后请逐条确认该片段在正文中确实原样存在，再输出。`;

export type StyleObservationOutcome = {
  observations: StyleObservation[];
  metricsText: string;
  charCount: number;
  /** 证据无法在原文中检索到而被丢弃的观察，保留原文便于排查提示词问题 */
  dropped: StyleObservation[];
  /** 判定为本文种特有、转入文种模板的条数 */
  documentSpecificCount: number;
};

/**
 * 观察单篇材料的写法。
 *
 * 只产出观察，不产出稳定性结论；证据检索不到的观察在这里就被丢掉，
 * 这是整条链路上防幻觉最有效的一道闸。
 */
export async function observeStyleProfile(
  article: string,
  options: { abortSignal?: AbortSignal } = {}
): Promise<StyleObservationOutcome> {
  const normalizedArticle = article.trim();
  if (!normalizedArticle) {
    throw new Error('待分析的文章内容不能为空。');
  }

  const metrics = measureStyleMetrics(normalizedArticle);
  const metricsText = formatStyleMetrics(metrics);
  // 指标算在全文上，送进模型的只需要采样；证据校验仍然回全文比对。
  const basePrompt = buildStyleObservationPrompt({
    article: sampleArticle(normalizedArticle),
    metricsText,
  });

  let lastOutcome: StyleObservationOutcome | undefined;

  // 模型偶尔会把证据改述成自己的话，导致全部观察被证据校验拦下。
  // 这时补一句更强的原样引用要求重试一次，比直接判失败划算得多。
  for (const reinforcement of ['', VERBATIM_EVIDENCE_REMINDER]) {
    const result = await generateStructured({
      schema: styleObservationResultSchema,
      system: styleObservationSystemPrompt,
      prompt: reinforcement ? `${basePrompt}\n\n${reinforcement}` : basePrompt,
      abortSignal: options.abortSignal,
    });

    const { kept, dropped } = verifyObservations(result.observations, normalizedArticle);
    const transferable = keepTransferableObservations(kept);

    lastOutcome = {
      observations: transferable,
      metricsText,
      charCount: metrics.charCount,
      dropped,
      documentSpecificCount: kept.length - transferable.length,
    };

    if (transferable.length) break;
  }

  return lastOutcome as StyleObservationOutcome;
}

const CROSS_DOCUMENT_SUPPORT_REMINDER = `注意：上一轮每条特征都只标注了极少数材料，全部因证据不足被剔除，结果为空。

逐篇观察是抽样的，同一种写法未必在每篇的观察记录里都被单独记下来。
判断 supportingDocumentIds 时，除了观察记录，还要核对各篇的实测指标：
某篇的观察虽未提及这条写法，但该篇实测指标明显支持（如引号凝练语密度相当、位次表达同样存在、段首领句形式一致），
就应把该篇一并列入，并在 detail 中依据指标说明。

这不是放宽标准，指标是程序统计的事实，比观察记录更可靠；但仍不得列入指标并不支持的材料。`;

export type StyleProfileBundle = StyleDocumentRef & {
  metricsText: string;
  observations: StyleObservation[];
};

export type StyleProfileResult = {
  /** 用户可见的分析报告 */
  report: string;
  /** 写作模型消费的风格约束 */
  constraints: string;
  profile: StyleProfileData;
};

/**
 * 汇总多篇观察并渲染最终画像。
 *
 * 模型只做语义合并与措辞，档位由 bandStyleFeatures 依据支持篇数计算，
 * 排版由渲染函数负责，两者都不受模型输出影响。
 */
export async function synthesizeStyleProfile(
  {
    subjectName,
    bundles,
  }: {
    subjectName: string;
    bundles: StyleProfileBundle[];
  },
  options: { abortSignal?: AbortSignal } = {}
): Promise<StyleProfileResult> {
  const usable = bundles.filter((bundle) => bundle.observations.length > 0);
  if (!usable.length) {
    throw new Error('没有通过证据校验的风格观察，无法生成写作风格画像。');
  }

  const basePrompt = buildStyleSynthesisPrompt({ subjectName, bundles: usable });
  const evidencePool = collectEvidencePool(usable);
  const documents = usable.map(({ documentId, title, date, charCount }) => ({
    documentId,
    title,
    date,
    charCount,
  }));

  const runSynthesis = (prompt: string) =>
    generateStructured({
      schema: styleSynthesisResultSchema,
      system: styleSynthesisSystemPrompt,
      prompt,
      abortSignal: options.abortSignal,
    });

  let profile: StyleProfileData | undefined;

  for (const reinforcement of ['', CROSS_DOCUMENT_SUPPORT_REMINDER]) {
    const synthesis = await runSynthesis(
      reinforcement ? `${basePrompt}\n\n${reinforcement}` : basePrompt
    );
    // 汇总阶段的 detail 是重新写的，模型偶尔会在引文里顺手添字
    // （实测出现过给原句加“持续七年”）。查不到出处的直接摘掉引号，不再额外调用模型订正。
    const sanitized = sanitizeUnsupportedQuotes(synthesis.features, evidencePool);
    profile = bandStyleFeatures({
      subjectName,
      documents,
      synthesis: { ...synthesis, features: sanitized },
    });
    if (profile.features.length) break;
  }

  if (!profile) {
    throw new Error('风格汇总未返回结果。');
  }

  // 重试后仍然全部证据不足时降级出报告，而不是报错。
  // 用户拿到一份标注偏弱的画像，总好过看到一句“证据不足”而一无所得。
  if (!profile.features.length && profile.incidental.length) {
    profile = { ...profile, features: profile.incidental, incidental: [] };
  }

  if (!profile.features.length) {
    throw new Error('汇总后没有可用的风格特征，请更换或增加参考材料。');
  }

  return {
    report: renderStyleReport(profile),
    constraints: renderStyleConstraints(profile),
    profile,
  };
}

/** 从原始材料一次性走完观察与汇总，供单篇分析和命令行脚本使用。 */
export async function buildStyleProfile(
  {
    subjectName,
    documents,
  }: {
    subjectName: string;
    documents: { documentId: string; title: string; date: string; article: string }[];
  },
  options: { abortSignal?: AbortSignal } = {}
): Promise<StyleProfileResult> {
  const bundles = await Promise.all(
    documents.map(async (document) => {
      const outcome = await observeStyleProfile(document.article, options);
      return {
        documentId: document.documentId,
        title: document.title,
        date: document.date,
        charCount: outcome.charCount,
        metricsText: outcome.metricsText,
        observations: outcome.observations,
      };
    })
  );

  return synthesizeStyleProfile({ subjectName, bundles }, options);
}

/**
 * 分析单篇文章并返回可读报告。
 *
 * 单篇模式不做跨篇稳定性验证，报告抬头会显式声明这一点，
 * 避免把一篇材料里的偶然写法说成作者的长期风格。
 */
export async function analyzeStyleProfile(
  article: string,
  options: { abortSignal?: AbortSignal; subjectName?: string; title?: string } = {}
) {
  const { report } = await buildStyleProfile(
    {
      subjectName: options.subjectName ?? '当前文档',
      documents: [
        {
          documentId: 'current',
          title: options.title ?? '当前文档',
          date: '',
          article,
        },
      ],
    },
    { abortSignal: options.abortSignal }
  );

  return report;
}

const styleProfileOutputSchema = z.object({
  styleProfile: z.string().min(1),
  articleLength: z.number().int().positive(),
});

/** Agent 使用的当前文章风格分析工具。调用前应先获取最新文档快照。 */
export const analyzeStyleProfileTool = createTool({
  id: 'analyzeStyleProfile',
  description:
    '根据输入的完整公文 Markdown 提取写作风格分析报告，用于指导后续写作。只分析输入文章，不修改文档或工作记忆。',
  inputSchema: z.object({
    article: z.string().min(1).describe('待分析的完整公文 Markdown 内容'),
    subjectName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('分析对象名称，未指定人物时不传'),
  }),
  outputSchema: styleProfileOutputSchema,
  execute: async ({ article, subjectName }, context) => ({
    styleProfile: await analyzeStyleProfile(article, {
      abortSignal: context.abortSignal,
      subjectName,
    }),
    articleLength: article.trim().length,
  }),
});
