import { config } from 'dotenv';
import { createJiti } from 'jiti';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

config({ path: '.env.local' });
config({ path: '.env' });

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mastra } = await jiti.import('../src/mastra/index.ts');

const currentDocument = {
  blocks: [],
  markdown: `# 2024年农村集体“三资”管理情况报告

2024年，全县农村集体经济组织资产总额达到3.2亿元，清查集体资产1248项，盘活闲置资源86处，村级集体经济组织经营性收入平均达到38.6万元。

## 一、规范资产管理

全县完成农村集体资产年度清查的村级组织占比87.6%，发现并整改问题42项，累计追回资金126万元。

## 二、提升经营质效

全年新增集体经济项目65个，带动村民就业1280人，村级经营性收入同比增长12.4%。`,
};

const documentSnapshotTool = createTool({
  id: 'getDocumentSnapshot',
  description: '测试用：返回当前编辑器中的整篇公文 Markdown。',
  inputSchema: z.object({
    query: z.string().optional(),
  }),
  outputSchema: z.object({
    blocks: z.array(
      z.object({
        path: z.array(z.number()),
        type: z.string(),
        text: z.string(),
      })
    ),
    markdown: z.string(),
  }),
  execute: async () => currentDocument,
});

let writtenMarkdown = '';
const writeMarkdownTool = createTool({
  id: 'writeMarkdownToPlate',
  description: '测试用：将更新后的完整 Markdown 写入模拟编辑器。',
  inputSchema: z.object({
    markdown: z.string().min(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ markdown }) => {
    writtenMarkdown = markdown;
    return { success: true };
  },
});

const agent = mastra.getAgentById('document-agent');
const clientTools = {
  getDocumentSnapshot: documentSnapshotTool,
  writeMarkdownToPlate: writeMarkdownTool,
};

function getToolCallParts(message) {
  return message?.content?.parts?.filter(
    (part) => part.type === 'tool-invocation' && part.toolInvocation
  ) ?? [];
}

function appendClientToolOutputs(messages, outputs) {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== 'assistant') {
    throw new Error('Agent 返回结果中没有可续传的 assistant tool call。');
  }

  const outputByCallId = new Map(
    outputs.map((item) => [item.toolCallId, item.output])
  );
  const updatedParts = lastMessage.content.parts.map((part) => {
    if (part.type !== 'tool-invocation') {
      return part;
    }

    const output = outputByCallId.get(part.toolInvocation.toolCallId);
    if (output === undefined) {
      return part;
    }

    return {
      ...part,
      toolInvocation: {
        ...part.toolInvocation,
        state: 'result',
        result: output,
      },
    };
  });

  return [
    ...messages.slice(0, -1),
    {
      ...lastMessage,
      content: {
        ...lastMessage.content,
        parts: updatedParts,
      },
    },
  ];
}

function getInvocationDetails(part) {
  return part.toolInvocation;
}

async function resolveClientToolOutput(toolInvocation) {
  const { toolCallId, toolName, args } = toolInvocation;

  if (toolName === 'getDocumentSnapshot') {
    return { toolCallId, toolName, output: currentDocument };
  }

  if (toolName === 'writeMarkdownToPlate') {
    writtenMarkdown = args.markdown;
    return { toolCallId, toolName, output: { success: true } };
  }

  throw new Error(`测试脚本未处理客户端工具：${toolName}`);
}

let result = await agent.generate(
  '请帮我把这份文章里的数据换成2025年的新数据。只识别并替换业务数据，然后把更新后的文章写回文档。',
  {
    maxSteps: 8,
    clientTools,
  }
);

const toolCalls = [];
for (let continuation = 0; continuation < 4; continuation += 1) {
  const toolCallParts = getToolCallParts(result.messages.at(-1));
  const pendingToolCallParts = toolCallParts.filter(
    (part) => getInvocationDetails(part).state === 'call'
  );

  for (const part of toolCallParts) {
    const invocation = getInvocationDetails(part);
    toolCalls.push({
      toolName: invocation.toolName,
      state: invocation.state,
      toolCallId: invocation.toolCallId,
    });
  }

  if (pendingToolCallParts.length === 0) {
    break;
  }

  const outputs = await Promise.all(
    pendingToolCallParts.map((part) =>
      resolveClientToolOutput(getInvocationDetails(part))
    )
  );

  result = await agent.generate(
    appendClientToolOutputs(result.messages, outputs),
    {
      maxSteps: 8,
      clientTools,
    }
  );
}

const toolNames = toolCalls.map((call) => call.toolName);
const requiredToolNames = [
  'getDocumentSnapshot',
  'simulateDocumentDataRefresh',
  'writeMarkdownToPlate',
];

for (const requiredToolName of requiredToolNames) {
  if (!toolNames.includes(requiredToolName)) {
    throw new Error(`缺少预期工具调用：${requiredToolName}`);
  }
}

if (!writtenMarkdown || writtenMarkdown === currentDocument.markdown) {
  throw new Error('模拟编辑器没有收到更新后的 Markdown。');
}

const forbiddenPhrases = ['模拟', '演示', '虚构', '假设', '如有实际数据'];
const forbiddenPhrase = forbiddenPhrases.find((phrase) =>
  writtenMarkdown.includes(phrase)
);

if (forbiddenPhrase) {
  throw new Error(`写回文档包含不应出现的措辞：${forbiddenPhrase}`);
}

console.log(
  JSON.stringify(
    {
      finishReason: result.finishReason,
      response: result.text,
      toolCalls,
      writtenMarkdownLength: writtenMarkdown.length,
      containsTargetYear: writtenMarkdown.includes('2025'),
    },
    null,
    2
  )
);
