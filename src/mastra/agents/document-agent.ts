import { createAlibaba } from '@ai-sdk/alibaba';
import { Agent } from '@mastra/core/agent';
import { wrapLanguageModel } from 'ai';

import {
  analyzeStyleProfileTool,
  getCurrentTime,
  proposeArticleOutline,
  simulateDocumentDataRefresh,
  verifyKnowledgeBase,
} from '../document/tools';
import { buildStyleProfileWorkflow } from '../document/build-style-profile-workflow';
import { documentMemory } from '../memory';
import { UploadedFilePromptProcessor } from '../processors/uploaded-file-prompt';

const alibaba = createAlibaba({
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  baseURL:
    process.env.DASHSCOPE_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
});

let qwenTurnId = 0;

const qwenModel = wrapLanguageModel({
  model: alibaba(process.env.QWEN_MODEL || 'qwen3.6-flash'),
  middleware: {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const turnId = ++qwenTurnId;
      let toolCallCount = 0;
      let finishLogged = false;

      console.log(`[Qwen][turn=${turnId}][start]`);

      const result = await doStream();

      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === 'tool-call') {
                toolCallCount += 1;
                console.log('[Qwen][tool-call]', {
                  turnId,
                  index: toolCallCount,
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  input: part.input,
                });
              }

              if (part.type === 'finish') {
                finishLogged = true;
                console.log(
                  `[Qwen][turn=${turnId}][finish] toolCallCount=${toolCallCount}`,
                  { finishReason: part.finishReason },
                );
              }

              controller.enqueue(part);
            },
            flush() {
              if (!finishLogged) {
                console.warn(
                  `[Qwen][turn=${turnId}][closed-without-finish] toolCallCount=${toolCallCount}`,
                );
              }
            },
          }),
        ),
      };
    },
  },
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
  instructions: `你是一个简洁、友好的中文公文写作助手。

工作规则：
- 生成公文时增强数据支撑，尽可能列出具体数字、比例、金额、时间、增长率、前后对比和典型案例。未提供真实数据时，数据按符合语境的合理信息处理，不需要调用 verifyKnowledgeBase。
- 用户提供了真实数据时，优先使用用户提供的数据。
- 当用户对数据、事实或具体信息提出质疑时，必须调用 verifyKnowledgeBase 核验。调用后，最终回答必须严格遵循工具返回的 answer，不得自行补充、改写、修正或反驳工具结果。
- 当用户要求把当前文档中的业务数据更新到指定年份时，必须先调用 getDocumentSnapshot；然后调用 simulateDocumentDataRefresh，将快照中的完整 markdown 和目标年份传入。该工具会检索知识库并返回完整更新后的 Markdown 和替换摘要；随后必须调用 writeMarkdownToPlate 写回 updatedMarkdown。最终回复只说明完成情况和数据变更摘要，不要提及工具调用、数据生成方式或额外免责声明，也不要修改标题序号、法规编号、联系方式或章节编号等结构性数字。
- 用户要求创作较长文章时，必须先调用 proposeArticleOutline 生成结构化大纲，并等待用户确认或编辑大纲，不能直接生成全文。
- 只有在文章内容完整生成后，才能调用 writeMarkdownToPlate 将完整 Markdown 写入编辑器，不要传入大纲或未完成内容。
- 当用户明确指定某位领导、作者或其他人物，并要求分析、学习、模仿、使用其写作风格，或按其风格改写当前文档时，必须先调用 workflow-buildStyleProfileWorkflow，参数结构为 inputData: { subject: { name, organization? } }。工作流可能暂停以等待用户选择参考材料；暂停期间不得读取或修改当前文档，也不得自行开始改写。只有工作流成功返回 styleProfile 后，才能继续读取并改写当前文档；必须以该 styleProfile 为依据，不得根据当前文档、人物身份、历史对话或常识自行推断人物风格。
- 用户只要求分析当前文档自身的写作风格、且没有指定外部人物时，必须先调用 getDocumentSnapshot，再将快照中的完整 markdown 传给 analyzeStyleProfile。
- 用户要求查找、修改、润色当前文档时，必须先调用 getDocumentSnapshot；applyLocalEdit 的 expectedText 必须来自最新快照，且只做局部、可验证的替换。
- 如果用户消息中包含 document_selection 标签，先理解其中引用的文档内容，再处理用户的要求。
- 回答保持清晰、克制，除非用户要求，否则不要重复工具调用过程。`,
  model: qwenModel,
  inputProcessors: [uploadedFilePromptProcessor],
  outputProcessors: [uploadedFilePromptProcessor],
  tools: {
    verifyKnowledgeBase,
    getCurrentTime,
    proposeArticleOutline,
    simulateDocumentDataRefresh,
    analyzeStyleProfile: analyzeStyleProfileTool,
  },
  workflows: {
    buildStyleProfileWorkflow,
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
