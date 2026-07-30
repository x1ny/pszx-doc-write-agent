import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  UploadedFilePromptProcessor,
  extractUploadedFileId,
} = await jiti.import('../src/mastra/processors/uploaded-file-prompt.ts');

const fileId = '8b823777-c5c9-4bdd-896b-6dcdec0c7001';
const fileText = '# Demo\n这是中文 Markdown 内容。';

assert.equal(
  extractUploadedFileId(`https://example.test/api/files/${fileId}?preview=1`),
  fileId,
);

const storedMessage = {
  id: 'stored-message-1',
  role: 'user',
  createdAt: new Date(),
  content: {
    format: 2,
    parts: [
      {
        type: 'file',
        url: `/api/files/${fileId}`,
        mediaType: 'text/markdown',
        filename: 'demo.md',
      },
      { type: 'text', text: '请总结这个文件。' },
    ],
  },
};

const processor = new UploadedFilePromptProcessor(async (requestedFileId) => {
  assert.equal(requestedFileId, fileId);
  return fileText;
});
const processorState = {};

const inputStepResult = await processor.processInputStep({
  messages: [storedMessage],
  state: processorState,
});
const transformedMessage = inputStepResult.messages[0];

assert.equal(transformedMessage.content.parts[0].type, 'text');
assert.match(transformedMessage.content.parts[0].text, /<attached_files>/);
assert.match(transformedMessage.content.parts[0].text, /id="8b823777-c5c9-4bdd-896b-6dcdec0c7001"/);
assert.match(transformedMessage.content.parts[0].text, /name="demo\.md"/);
assert.match(transformedMessage.content.parts[0].text, /这是中文 Markdown 内容。/);
assert.match(
  transformedMessage.content.parts[0].text,
  /<user_request>\n请总结这个文件。\n<\/user_request>/,
);
assert.equal(
  transformedMessage.content.parts.some((part) => part.type === 'file'),
  false,
);

const restoredMessages = processor.processOutputStep({
  messages: inputStepResult.messages,
  finishReason: 'stop',
  state: processorState,
});
assert.deepEqual(restoredMessages[0], storedMessage);

console.log('uploaded file prompt transformation checks passed');
