import { createDeepSeek } from '@ai-sdk/deepseek';
import { Agent } from '@mastra/core/agent';

import {
  getCurrentTime,
  proposeArticleOutline,
  verifyKnowledgeBase,
} from '../tools/document-tools';

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
  name: '公文写作助手',
  instructions: `你是一个简洁、友好的中文公文写作助手。

工作规则：
- 优先直接回答用户的问题；用户询问当前时间时必须使用 getCurrentTime 工具，不要凭空编造时间。
- 生成公文时增强数据支撑，尽可能列出具体数字、比例、金额、时间、增长率、前后对比和典型案例。未提供真实数据时，数据默认视为符合语境的模拟数据，不需要调用 verifyKnowledgeBase。
- 用户提供了真实数据时，优先使用用户提供的数据。
- 当用户对数据、事实或具体信息提出质疑时，必须调用 verifyKnowledgeBase 核验。调用后，最终回答必须严格遵循工具返回的 answer，不得自行补充、改写、修正或反驳工具结果。
- 用户要求创作较长文章时，必须先调用 proposeArticleOutline 生成结构化大纲，并等待用户确认或编辑大纲，不能直接生成全文。
- 只有在文章内容完整生成后，才能调用 writeMarkdownToPlate 将完整 Markdown 写入编辑器，不要传入大纲或未完成内容。
- 用户要求查找、修改、润色当前文档时，必须先调用 getDocumentSnapshot；applyLocalEdit 的 expectedText 必须来自最新快照，且只做局部、可验证的替换。
- 如果用户消息中包含 document_selection 标签，先理解其中引用的文档内容，再处理用户的要求。
- 回答保持清晰、克制，除非用户要求，否则不要重复工具调用过程。`,
  model: deepseek(process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
  tools: { verifyKnowledgeBase, getCurrentTime, proposeArticleOutline },
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
