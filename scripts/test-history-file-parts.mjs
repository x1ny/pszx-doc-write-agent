import assert from 'node:assert/strict';
import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { restoreUploadedFilePartsFromStored } = await jiti.import(
  '../src/lib/uploaded-file-reference.ts',
);

const docxMediaType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const firstId = 'cf9cc706-3a69-42fc-9d75-d7947dcd7eec';
const secondId = '0c8d84f5-8230-442f-bbb2-0e8acb0dbe09';

const storedMessages = [
  {
    id: 'm1',
    role: 'user',
    createdAt: new Date(),
    threadId: 't1',
    resourceId: 'r1',
    content: {
      format: 2,
      parts: [
        {
          type: 'file',
          mimeType: docxMediaType,
          data: `/api/files/${firstId}`,
          filename: '测试文档.docx',
        },
        {
          type: 'file',
          mimeType: 'text/markdown',
          data: `/api/files/${secondId}`,
          filename: '第二个文件.md',
        },
        { type: 'text', text: '请总结这两个文件。' },
      ],
      content: '请总结这两个文件。',
    },
  },
  {
    id: 'm2',
    role: 'assistant',
    createdAt: new Date(),
    threadId: 't1',
    resourceId: 'r1',
    content: { format: 2, parts: [{ type: 'text', text: '好的。' }] },
  },
];

const converted = toAISdkMessages(storedMessages, { version: 'v6' });

// 转换本身会把 data 当成 base64 正文，拼出打不开的地址并丢掉 filename。
const convertedFile = converted[0].parts.find((part) => part.type === 'file');
assert.ok(convertedFile.url.startsWith('data:'));
assert.equal(convertedFile.filename, undefined);

const restored = restoreUploadedFilePartsFromStored(converted, storedMessages);
const files = restored[0].parts.filter((part) => part.type === 'file');

assert.equal(files.length, 2);
assert.equal(files[0].url, `/api/files/${firstId}`);
assert.equal(files[0].filename, '测试文档.docx');
assert.equal(files[0].mediaType, docxMediaType);
assert.equal(files[1].url, `/api/files/${secondId}`);
assert.equal(files[1].filename, '第二个文件.md');
assert.equal(files[1].mediaType, 'text/markdown');

// 非文件消息和文本 part 必须原样保留。
assert.equal(
  restored[0].parts.find((part) => part.type === 'text').text,
  '请总结这两个文件。',
);
assert.deepEqual(restored[1], converted[1]);

// 没有对应存储记录时不应破坏原始 part。
const orphan = restoreUploadedFilePartsFromStored(converted, []);
assert.deepEqual(orphan[0].parts, converted[0].parts);

console.log('history file part restoration checks passed');
