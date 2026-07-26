import { config } from 'dotenv';
import { createJiti } from 'jiti';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

config({ path: '.env.local' });
config({ path: '.env' });

const prompt = process.argv.slice(2).join(' ').trim() ||
  '请帮我把当前公文改成李局长的写作风格';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mastra } = await jiti.import('../src/mastra/index.ts');
const { simulateLeaderStyleAnalysis } = await jiti.import(
  '../src/mastra/tools/document-tools.ts'
);

const currentDocument = {
  blocks: [],
  markdown: `# 关于推动人工智能发展的建议

当前，人工智能正加速融入经济社会各领域，成为推动产业升级和治理现代化的重要力量。本文围绕技术创新、产业应用和人才培养提出相关建议。

## 一、强化技术创新

加大基础研究投入，支持人工智能关键算法、算力平台和应用技术攻关，推动产学研深度融合。

## 二、推进产业应用

支持人工智能在制造、医疗、教育等领域落地，建设一批示范应用场景，促进产业高质量发展。

## 三、加强人才培养

完善人才培养和引进机制，鼓励高校、科研机构与企业联合培养人工智能专业人才。`,
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
  execute: async () => ({
    ...currentDocument,
  }),
});

let writtenMarkdown = '';
const writeMarkdownTool = createTool({
  id: 'writeMarkdownToPlate',
  description: '测试用：将改写后的完整 Markdown 写入模拟编辑器。',
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

async function resolveClientToolOutput(toolInvocation) {
  const { toolCallId, toolName, args } = toolInvocation;

  if (toolName === 'getDocumentSnapshot') {
    return { toolCallId, toolName, output: currentDocument };
  }

  if (toolName === 'simulateLeaderStyleAnalysis') {
    const output = await simulateLeaderStyleAnalysis.execute(args, {
      writer: { custom: async () => undefined },
    });
    return { toolCallId, toolName, output };
  }

  if (toolName === 'writeMarkdownToPlate') {
    writtenMarkdown = args.markdown;
    return { toolCallId, toolName, output: { success: true } };
  }

  throw new Error(`测试脚本未处理客户端工具：${toolName}`);
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

let result = await agent.generate(prompt, {
  maxSteps: 8,
  clientTools,
});

const toolCallRegistry = new Map();
for (let continuation = 0; continuation < 4; continuation += 1) {
  const toolCallParts = getToolCallParts(result.messages.at(-1));
  const pendingToolCallParts = toolCallParts.filter(
    (part) => part.toolInvocation.state === 'call'
  );

  for (const part of toolCallParts) {
    toolCallRegistry.set(part.toolInvocation.toolCallId, {
      toolName: part.toolInvocation.toolName,
      args: part.toolInvocation.args,
      toolCallId: part.toolInvocation.toolCallId,
      state: part.toolInvocation.state,
    });
  }

  if (pendingToolCallParts.length === 0) {
    break;
  }

  const outputs = await Promise.all(
    pendingToolCallParts.map((part) =>
      resolveClientToolOutput(part.toolInvocation)
    )
  );

  result = await agent.generate(appendClientToolOutputs(result.messages, outputs), {
    maxSteps: 8,
    clientTools,
  });
}

console.log('\n=== Execution metadata ===');
console.log(JSON.stringify({
  finishReason: result.finishReason,
  toolCallCount: toolCallRegistry.size,
}, null, 2));

console.log('\n=== Agent response ===');
console.log(result.text);
console.log('\n=== Tool calls ===');
console.log(
  JSON.stringify(
    [...toolCallRegistry.values()],
    null,
    2
  )
);
console.log('\n=== Mock editor write ===');
console.log(
  JSON.stringify(
    {
      success: Boolean(writtenMarkdown),
      markdownLength: writtenMarkdown.length,
    },
    null,
    2
  )
);
