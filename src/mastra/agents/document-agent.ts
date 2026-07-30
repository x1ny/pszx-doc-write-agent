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
import { documentWorkspace } from '@/lib/file-workspace';
import { UploadedFilePromptProcessor } from '../processors/uploaded-file-prompt';

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

const workingMemoryToolNames = new Set([
  'updateWorkingMemory',
  'setWorkingMemory',
  'update-working-memory',
]);

const uploadedFilePromptProcessor = new UploadedFilePromptProcessor();

export const documentAgent = new Agent({
  id: 'document-agent',
  memory: documentMemory,
  name: '公文写作助手',
  instructions: `长期偏好规则：只有当用户明确表达“以后都这样”“请记住”“我的常用风格是”“保存到工作记忆”等会在未来对话中继续适用的写作偏好时，才使用 Working Memory 保存或更新这些信息。任何一次性的改写、润色、人物风格分析或当前任务总结，都不得写入 Working Memory；除非用户明确要求保存，也不得在回复中声称已经保存。优先记录稳定的风格、结构、语气、数据使用和常用表达偏好；不要保存一次性的任务内容或不必要的敏感信息。后续写作时应参考已保存的偏好。

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
- 风格改写有两种不同路径，必须严格区分：
  1. 用户只说“风格改写”“风格重写”“按我的风格改写”，或要求使用已记住、已保存、工作记忆中的风格时，直接读取 Working Memory 中已有的写作偏好，不得调用 simulateLeaderStyleAnalysis，也不得根据历史对话臆测人物。此时先调用 getDocumentSnapshot，再依据 Working Memory 改写完整 markdown，最后调用 writeMarkdownToPlate 写回编辑器。
  2. 只有用户在当前消息中明确要求学习、检索、分析、研究或模仿某位明确指出的领导/作者的历史写作风格时，才调用 getDocumentSnapshot 和 simulateLeaderStyleAnalysis。不能因为 Working Memory 中出现了某个人名，或之前做过人物风格分析，就把普通“风格改写”升级为人物风格学习。
  改写完成后都必须调用 writeMarkdownToPlate 写入完整文章，并在最终回复中说明主要修改内容；人物风格路径还需说明风格总结。
- 风格改写默认是一次性任务，只读取 Working Memory，不更新 Working Memory。除非用户在当前消息明确要求记住或保存本次风格，否则不要调用 Working Memory 更新工具，也不要说“已保存至工作记忆”。
- 如果用户消息中包含 document_selection 标签，先理解其中引用的文档内容，再处理用户的要求。
- 回答保持清晰、克制，除非用户要求，否则不要重复工具调用过程。`,
  model: deepseek(process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
  workspace: documentWorkspace,
  inputProcessors: [uploadedFilePromptProcessor],
  outputProcessors: [uploadedFilePromptProcessor],
  tools: {
    verifyKnowledgeBase,
    getCurrentTime,
    proposeArticleOutline,
    simulateDocumentDataRefresh,
    simulateLeaderStyleAnalysis,
  },
  hooks: {
    beforeToolCall: ({ toolName, input }) => {
      if (!workingMemoryToolNames.has(toolName)) {
        return;
      }

      console.log(`\n[WorkingMemory][before] ${toolName}`);
      console.log('[WorkingMemory][input]', formatDebugValue(input));
    },
    afterToolCall: ({ toolName, output, error }) => {
      if (!workingMemoryToolNames.has(toolName)) {
        return;
      }

      if (error) {
        console.error(`\n[WorkingMemory][after][error] ${toolName}`);
        console.error(formatDebugValue(error));
        return;
      }

      console.log(`\n[WorkingMemory][after] ${toolName}`);
      console.log('[WorkingMemory][output]', formatDebugValue(output));
    },
  },
});
