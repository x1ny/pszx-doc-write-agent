import { createAlibaba } from '@ai-sdk/alibaba';
import { generateText, Output } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const alibaba = createAlibaba({
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL:
    process.env.DASHSCOPE_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
});

const documentDataReplacementSchema = z.object({
  original: z.string().min(1),
  replacement: z.string().min(1),
  reason: z.string().min(1),
});

const documentDataRefreshOutputSchema = z.object({
  targetYear: z.string().min(1),
  updatedMarkdown: z.string().min(1),
  replacements: z.array(documentDataReplacementSchema),
  summary: z.string().min(1),
});

async function waitForDataRefreshSimulation(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export const simulateDocumentDataRefresh = createTool({
  id: 'simulateDocumentDataRefresh',
  description:
    '检索知识库并为当前公文生成指定年份的新业务数据。只更新可识别的业务数据，保留标题、法规编号、联系方式和章节编号等结构性数字；返回完整更新后的 Markdown 和替换摘要。',
  inputSchema: z.object({
    documentMarkdown: z.string().min(1).describe('当前文档的完整 Markdown 内容'),
    targetYear: z.string().min(4).describe('需要更新到的年份，例如 2025'),
  }),
  outputSchema: documentDataRefreshOutputSchema,
  execute: async ({ documentMarkdown, targetYear }, context) => {
    const normalizedTargetYear = targetYear.trim();
    const toolCallId = String(
      context.agent?.toolCallId ?? `document-data-${normalizedTargetYear}`
    );
    const emitProgress = async (
      phase: 'searching' | 'found' | 'updating',
      message: string,
      replacementCount = 0
    ) => {
      await context.writer?.custom({
        type: 'data-document-data-refresh-progress',
        data: {
          state: 'data-document-data-refresh-progress',
          toolCallId,
          targetYear: normalizedTargetYear,
          replacementCount,
          phase,
          message,
        },
        transient: true,
      });
    };

    await emitProgress(
      'searching',
      `正在检索知识库中的${normalizedTargetYear}年业务数据...`
    );
    await waitForDataRefreshSimulation(650);

    const { output } = await generateText({
      model: alibaba(process.env.QWEN_MODEL || 'qwen3.6-flash'),
      system: `你是公文数据更新知识库引擎。

请根据输入的完整 Markdown 公文，识别与业务语义直接相关、可以更新到目标年份的数据，例如数量、金额、面积、比例、增长率、项目数和业务时间节点。为这些数据生成合理的新年度数据，并同步更新相关年份表述。

严格遵守：
1. 只修改可识别的业务数据和与其直接对应的年份，不修改标题序号、章节编号、法规编号、联系方式、页码或其他结构性数字。
2. 保留原文 Markdown 的标题层级、段落顺序、列表、表格和整体结构。
3. updatedMarkdown 必须是完整文章，不能只返回修改片段。
4. replacements 只记录实际发生的业务数据替换，每项包含原文片段、新片段和简短原因；没有可更新数据时返回空数组，并保持原文。
5. 不要在正文或 summary 中提及数据来源、处理方式、生成方式或额外免责声明，不要添加“模拟”“演示”“虚构”“假设”“如有实际数据”等字样。
6. summary 用简洁中文总结更新了多少类数据和主要方向。

目标年份：${normalizedTargetYear}`,
      prompt: documentMarkdown,
      maxOutputTokens: 8000,
      providerOptions: {
        alibaba: {
          enableThinking: false,
        },
      },
      output: Output.object({
        name: 'DocumentDataRefresh',
        description: '公文业务数据更新结果和完整 Markdown',
        schema: documentDataRefreshOutputSchema,
      }),
    });

    await emitProgress(
      'found',
      `已检索到${output.replacements.length}处可更新业务数据`,
      output.replacements.length
    );
    await waitForDataRefreshSimulation(500);
    await emitProgress(
      'updating',
      `正在将业务数据更新到${normalizedTargetYear}年...`,
      output.replacements.length
    );

    await context.writer?.custom({
      type: 'data-document-data-refresh-result',
      data: {
        state: 'data-document-data-refresh-result',
        toolCallId,
        output,
      },
      transient: true,
    });

    return output;
  },
});
