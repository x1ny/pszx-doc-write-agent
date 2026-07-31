import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const leaderStyleOutputSchema = z.object({
  leaderName: z.string(),
  materialCount: z.number(),
  styleSummary: z.string(),
  styleFeatures: z.array(z.string()),
  rewriteGuidance: z.array(z.string()),
});

const fixedLeaderStyleSummary =
  '整体呈现用词精炼、结构严谨、数据全面、重点突出、责任清晰的写作特点。文章通常先交代背景和目标，再围绕问题分层提出措施，强调政策落地、时间节点、责任分工和结果导向，语言正式克制，少用空泛表述。';

const fixedLeaderStyleFeatures = [
  '用词精炼，句式简洁，避免重复铺陈和过度修饰。',
  '结构严谨，按照背景分析、问题研判、工作任务、保障措施逐层展开。',
  '数据全面，优先使用时间、数量、比例、目标和完成节点增强说服力。',
  '措施具体，明确重点任务、责任主体、实施路径和预期成效。',
  '表达正式克制，突出问题导向、结果导向和政策执行力度。',
];

const fixedRewriteGuidance = [
  '压缩空泛的背景铺垫，将核心判断前置。',
  '把原则性表述改写为可执行的任务、机制和保障措施。',
  '补充或保留必要的数据、时间节点、责任分工和预期目标。',
  '统一标题层级和段落节奏，增强全文的公文规范性。',
];

async function waitForLeaderStyleSimulation(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 历史人物风格入口目前保留现有演示行为；当前文章的真实风格分析使用
 * style-profile.ts 中的 analyzeStyleProfileTool，两条路径不要混用。
 */
export const simulateLeaderStyleAnalysis = createTool({
  id: 'simulateLeaderStyleAnalysis',
  description:
    '仅当用户在当前消息中明确要求学习、检索、分析、研究或模仿某位明确指出的领导或作者的历史写作风格时使用。不要用于“风格改写”“按我的风格改写”或使用 Working Memory/已保存风格的请求，也不要从历史对话或 Working Memory 臆测人物名称。',
  inputSchema: z.object({
    leaderName: z.string().min(1).describe('用户希望模仿的领导或作者名称'),
  }),
  outputSchema: leaderStyleOutputSchema,
  execute: async ({ leaderName }, context) => {
    const normalizedLeaderName = leaderName.trim();
    const materialCount = 35;
    const toolCallId = String(context.agent?.toolCallId ?? normalizedLeaderName);
    const emitProgress = async (
      phase: 'searching' | 'found' | 'summarizing',
      message: string
    ) => {
      await context.writer?.custom({
        type: 'data-style-rewrite-progress',
        data: {
          state: 'data-style-rewrite-progress',
          toolCallId,
          phase,
          leaderName: normalizedLeaderName,
          materialCount,
          message,
        },
        transient: true,
      });
    };

    await emitProgress(
      'searching',
      `正在查找${normalizedLeaderName}的历史材料...`
    );
    await waitForLeaderStyleSimulation(450);
    await emitProgress(
      'found',
      `已在系统中找到${normalizedLeaderName}的${materialCount}篇材料`
    );
    await waitForLeaderStyleSimulation(650);
    await emitProgress('summarizing', '正在总结写作风格...');
    await waitForLeaderStyleSimulation(650);

    const output = {
      leaderName: normalizedLeaderName,
      materialCount,
      styleSummary: fixedLeaderStyleSummary,
      styleFeatures: fixedLeaderStyleFeatures,
      rewriteGuidance: fixedRewriteGuidance,
    };

    await context.writer?.custom({
      type: 'data-style-rewrite-result',
      data: {
        state: 'data-style-rewrite-result',
        toolCallId,
        output,
      },
      transient: true,
    });

    return output;
  },
});
