import assert from 'node:assert/strict';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const fileId =
  process.argv[process.argv[2] === '--real' ? 3 : 2] ||
  '0c8d84f5-8230-442f-bbb2-0e8acb0dbe09';
const requestArgStart = process.argv[2] === '--real' ? 4 : 3;
const requestText =
  process.argv.slice(requestArgStart).join(' ') || '请用一句话概括这个文件。';
const realRequest = process.argv[2] === '--real';
let capturedRequest;

const nativeFetch = globalThis.fetch;

const captureRequest = async (input, init) => {
  capturedRequest = JSON.parse(String(init?.body));

  if (realRequest) {
    return nativeFetch(input, init);
  }

  return new Response(
    JSON.stringify({
      id: 'mock-completion-id',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '文件链路测试成功。',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};

globalThis.fetch = captureRequest;

const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mastra } = await jiti.import('../src/mastra/index.ts');
const agent = mastra.getAgentById('document-agent');

const inputMessage = {
  id: 'uploaded-file-agent-test',
  role: 'user',
  parts: [
    {
      type: 'file',
      url: `/api/files/${fileId}`,
      mediaType: 'text/markdown',
      filename: 'chat-agent.md',
    },
    {
      type: 'text',
      text: requestText,
    },
  ],
};

const result = await agent.generate(inputMessage, { maxSteps: 1 });
if (!realRequest) {
  assert.equal(result.text, '文件链路测试成功。');
}
assert.ok(capturedRequest);

const userRequest = capturedRequest.messages.find(
  (message) => message.role === 'user',
);
assert.ok(userRequest);

// 不同 provider 的 user.content 形态不同：DeepSeek 是扁平字符串，
// Alibaba 是 parts 数组。这里统一取出文本再断言。
const userContent =
  typeof userRequest.content === 'string'
    ? userRequest.content
    : userRequest.content
        .map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
        .join('\n');

assert.equal((userContent.match(/<attached_files>/g) || []).length, 1);
assert.equal((userContent.match(/<user_request>/g) || []).length, 1);
assert.match(userContent, /这是中文 Markdown 内容|Agent 架构调整方案/);
assert.match(userContent, new RegExp(requestText));
assert.equal(userContent.includes('/api/files/'), false);
assert.equal(userContent.includes('data:text/markdown'), false);

const returnedUserMessage = result.messages.find(
  (message) => message.role === 'user',
);
assert.ok(returnedUserMessage);
assert.equal(
  returnedUserMessage.content.parts.some((part) => part.type === 'file'),
  true,
);

console.log(
  JSON.stringify(
    {
      mode: realRequest ? 'real' : 'mock',
      response: result.text,
      providerUserContent: userContent.slice(0, 180),
      persistedUserParts: returnedUserMessage.content.parts.map(
        (part) => part.type,
      ),
    },
    null,
    2,
  ),
);
