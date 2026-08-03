import path from 'node:path';
import crypto from 'node:crypto';

import {
  allowedExtensions,
  maxUploadSize,
  getContentPath,
  getMetadataPath,
  uploadStorage,
  type UploadedFileRecord,
} from '@/lib/file-storage';
import { createDocumentMaterial } from '@/mastra/document/materials';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return jsonError('请使用 file 字段上传文件。', 400);
  }

  if (file.size === 0) {
    return jsonError('不能上传空文件。', 400);
  }

  if (file.size > maxUploadSize) {
    return jsonError('文件大小不能超过 10MB。', 413);
  }

  const extension = path.extname(file.name).toLowerCase();

  if (!allowedExtensions.has(extension)) {
    return jsonError('当前仅支持 .docx、.md、.markdown 和 .txt 文件。', 415);
  }

  const id = crypto.randomUUID();
  const contentPath = getContentPath(id, extension);
  const metadataPath = getMetadataPath(id);
  const record: UploadedFileRecord = {
    id,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    extension,
    contentPath,
    createdAt: new Date().toISOString(),
    sourceType: 'upload',
  };

  try {
    await uploadStorage.init();
    await uploadStorage.writeFile(
      contentPath,
      Buffer.from(await file.arrayBuffer()),
      {
        overwrite: false,
        mimeType: record.mimeType,
      },
    );
    await uploadStorage.writeFile(
      metadataPath,
      JSON.stringify(record, null, 2),
      {
        overwrite: false,
        mimeType: 'application/json',
      },
    );
  } catch (error) {
    await uploadStorage.deleteFile(contentPath).catch(() => {});
    await uploadStorage.rmdir(id).catch(() => {});
    console.error('[files] upload failed', error);
    return jsonError('文件保存失败。', 500);
  }

  return Response.json(createDocumentMaterial(record), { status: 201 });
}
