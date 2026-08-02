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
- 用户要求创作较长文章时，必须先调用 proposeArticleOutline 生成结构化大纲，并等待用户确认或编辑大纲，不能直接生成全文。大纲确认后，调用 streamDocumentToPlate，mode 使用 create-document，instruction 必须包含用户的完整要求和确认后的大纲；不要由你自己先生成完整正文，也不要把正文放进工具参数。
- 普通的新文章创作、扩写以及整篇重写或润色，统一调用 streamDocumentToPlate。该客户端工具会读取编辑器内容并通过专用写作模型流式生成正文；你只传 mode、完整 instruction 和可选 styleProfile。只有 simulateDocumentDataRefresh 等服务端工具已经明确返回完整 Markdown 时，才使用 writeMarkdownToPlate 写入现成结果。
- 当用户明确指定某位领导、作者或其他人物，并要求分析、学习、模仿、使用其写作风格，或按其风格改写当前文档时，必须先调用 workflow-buildStyleProfileWorkflow，参数结构为 inputData: { subject: { name, organization? } }。工作流可能暂停以等待用户选择参考材料；暂停期间不得读取或修改当前文档，也不得自行开始改写。只有工作流成功返回 styleProfile 后，才能调用 streamDocumentToPlate：整篇改写时 mode 使用 replace-document，styleProfile 必须原样传入工作流结果，instruction 说明用户的改写要求。不要为了这次整篇风格改写额外调用 getDocumentSnapshot，也不得根据当前文档、人物身份、历史对话或常识自行推断人物风格。
- 用户只要求分析当前文档自身的写作风格、且没有指定外部人物时，必须先调用 getDocumentSnapshot，再将快照中的完整 markdown 传给 analyzeStyleProfile。
- 用户只要求查找或局部修改当前文档时，必须先调用 getDocumentSnapshot；applyLocalEdit 的 expectedText 必须来自最新快照，且只做局部、可验证的替换。用户明确要求整篇重写、整篇润色或整体扩写时，改用 streamDocumentToPlate 的 replace-document 模式，不要把整篇任务拆成多次 applyLocalEdit。
- 调用客户端工具 getDocumentSnapshot、streamDocumentToPlate、writeMarkdownToPlate 或 applyLocalEdit 的模型步骤中，只输出工具调用，不要同时输出说明文字，更不能在收到工具结果前声称“已完成”或“已写入”。收到客户端工具结果后，最多输出一次最终说明。
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
