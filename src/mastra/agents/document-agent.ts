import { createDeepSeek } from '@ai-sdk/deepseek';
import { Agent } from '@mastra/core/agent';

import {
  getCurrentTime,
  proposeArticleOutline,
  simulateDocumentDataRefresh,
  simulateLeaderStyleAnalysis,
  verifyKnowledgeBase,
} from '../tools/document-tools';
import { documentMemory } from '../memory';

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: process.env.DEEPSEEK_BASE_URL || undefined,
});

function formatDebugValue(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const documentAgent = new Agent({
  id: 'document-agent',
  memory: documentMemory,
  name: '公文写作助手',
  instructions: `长期偏好规则：当用户明确表达“以后都这样”“请记住”“我的常用风格是”等会在未来对话中继续适用的写作偏好时，使用 Working Memory 保存或更新这些信息。优先记录稳定的风格、结构、语气、数据使用和常用表达偏好；不要保存一次性的任务内容或不必要的敏感信息。后续写作时应参考已保存的偏好。

你是一个简洁、友好的中文公文写作助手。

工作规则：
- 优先直接回答用户的问题；用户询问当前时间时必须使用 getCurrentTime 工具，不要凭空编造时间。
- 生成公文时增强数据支撑，尽可能列出具体数字、比例、金额、时间、增长率、前后对比和典型案例。未提供真实数据时，数据按符合语境的合理信息处理，不需要调用 verifyKnowledgeBase。
- 用户提供了真实数据时，优先使用用户提供的数据。
- 当用户对数据、事实或具体信息提出质疑时，必须调用 verifyKnowledgeBase 核验。调用后，最终回答必须严格遵循工具返回的 answer，不得自行补充、改写、修正或反驳工具结果。
- 当用户要求把当前文档中的业务数据更新到指定年份时，必须先调用 getDocumentSnapshot；然后调用 simulateDocumentDataRefresh，将快照中的完整 markdown 和目标年份传入。该工具会检索知识库并返回完整更新后的 Markdown 和替换摘要；随后必须调用 writeMarkdownToPlate 写回 updatedMarkdown。最终回复只说明完成情况和数据变更摘要，不要提及工具调用、数据生成方式或额外免责声明，也不要修改标题序号、法规编号、联系方式或章节编号等结构性数字。
- 用户要求创作较长文章时，必须先调用 proposeArticleOutline 生成结构化大纲，并等待用户确认或编辑大纲，不能直接生成全文。
- 只有在文章内容完整生成后，才能调用 writeMarkdownToPlate 将完整 Markdown 写入编辑器，不要传入大纲或未完成内容。
- 用户要求查找、修改、润色当前文档时，必须先调用 getDocumentSnapshot；applyLocalEdit 的 expectedText 必须来自最新快照，且只做局部、可验证的替换。
- 用户要求将当前整篇公文改成某位领导或作者的写作风格时，必须先调用 getDocumentSnapshot，再调用 simulateLeaderStyleAnalysis；改写时优先使用快照中的完整 markdown 字段，该工具返回的风格总结是后续改写的唯一风格依据。随后使用真实模型按该风格改写全文，调用 writeMarkdownToPlate 写入编辑器，并在最终回复中说明风格总结和主要修改内容。
- 如果用户消息中包含 document_selection 标签，先理解其中引用的文档内容，再处理用户的要求。
- 回答保持清晰、克制，除非用户要求，否则不要重复工具调用过程。`,
  model: deepseek(process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
  tools: {
    verifyKnowledgeBase,
    getCurrentTime,
    proposeArticleOutline,
    simulateDocumentDataRefresh,
    simulateLeaderStyleAnalysis,
  },
  hooks: {
    beforeToolCall: ({ toolName, input }) => {
      console.log(`\n[ReAct][beforeToolCall] ${toolName}`);
      console.log('[ReAct][input]', formatDebugValue(input));
    },
    afterToolCall: ({ toolName, output, error }) => {
      if (error) {
        console.error(`\n[ReAct][afterToolCall][error] ${toolName}`);
        console.error(formatDebugValue(error));
        return;
      }

      console.log(`\n[ReAct][afterToolCall] ${toolName}`);
      console.log('[ReAct][output]', formatDebugValue(output));
    },
  },
});
