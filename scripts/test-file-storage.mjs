import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  documentStorage,
  getContentPath,
  getMetadataPath,
  uploadStorage,
} = await jiti.import('../src/lib/file-storage.ts');
const { readUploadedFileText } = await jiti.import(
  '../src/mastra/processors/uploaded-file-prompt.ts',
);

const id = crypto.randomUUID();
const contentPath = getContentPath(id, '.md');
const metadataPath = getMetadataPath(id);
const article = '# 测试标题\n这是一段中文正文，用于验证 UTF-8 不被破坏。\n';
const record = {
  id,
  originalName: '中文材料.md',
  mimeType: 'text/markdown',
  size: Buffer.byteLength(article, 'utf8'),
  extension: '.md',
  contentPath,
  createdAt: new Date().toISOString(),
  sourceType: 'upload',
};

await uploadStorage.init();

try {
  await uploadStorage.writeFile(contentPath, Buffer.from(article, 'utf8'), {
    overwrite: false,
    mimeType: record.mimeType,
  });
  await uploadStorage.writeFile(metadataPath, JSON.stringify(record, null, 2), {
    overwrite: false,
    mimeType: 'application/json',
  });

  assert.equal(await uploadStorage.exists(contentPath), true);
  assert.equal(await uploadStorage.exists(getContentPath(id, '.txt')), false);

  // 不传 encoding 必须拿到原始字节，否则中文和 docx 都会损坏。
  const buffer = await uploadStorage.readFile(contentPath);
  assert.ok(Buffer.isBuffer(buffer), 'readFile 未返回 Buffer');
  assert.equal(buffer.toString('utf8'), article);

  const metadata = JSON.parse(
    await uploadStorage.readFile(metadataPath, { encoding: 'utf8' }),
  );
  assert.equal(metadata.originalName, record.originalName);

  // overwrite: false 必须由服务端拒绝，避免先查后写的竞态。
  await assert.rejects(
    () =>
      uploadStorage.writeFile(contentPath, Buffer.from('覆盖内容', 'utf8'), {
        overwrite: false,
      }),
    /禁止覆盖/,
    'overwrite:false 没有阻止覆盖写入',
  );

  await uploadStorage.writeFile(contentPath, Buffer.from(article, 'utf8'), {
    overwrite: true,
  });

  // Agent 侧只读通道，走的是同一份对象。
  assert.equal(await readUploadedFileText(id), article);
  assert.equal(typeof documentStorage.writeFile, 'undefined');
  assert.equal(typeof documentStorage.deleteFile, 'undefined');

  // 前导 / 归一化到同一个对象（不构成越权），.. 必须被拦住。
  assert.equal(
    (await uploadStorage.readFile(`/${contentPath}`)).toString('utf8'),
    article,
  );
  await assert.rejects(
    () => uploadStorage.readFile(`${id}/../${id}/content.md`),
    /非法的对象存储路径/,
  );
} finally {
  await uploadStorage.rmdir(id);
}

assert.equal(await uploadStorage.exists(contentPath), false);
assert.equal(await uploadStorage.exists(metadataPath), false);

console.log('file storage checks passed');
