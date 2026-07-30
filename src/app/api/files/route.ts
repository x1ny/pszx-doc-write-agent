import path from 'node:path';
import crypto from 'node:crypto';

import {
  allowedExtensions,
  maxUploadSize,
  getContentPath,
  getMetadataPath,
  uploadFilesystem,
  type UploadedFileRecord,
} from '@/lib/file-workspace';

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
  };

  try {
    await uploadFilesystem.init();
    await uploadFilesystem.writeFile(
      contentPath,
      Buffer.from(await file.arrayBuffer()),
      {
        recursive: true,
        overwrite: false,
        mimeType: record.mimeType,
      },
    );
    await uploadFilesystem.writeFile(
      metadataPath,
      JSON.stringify(record, null, 2),
      {
        recursive: true,
        overwrite: false,
        mimeType: 'application/json',
      },
    );
  } catch (error) {
    await uploadFilesystem.deleteFile(contentPath, { force: true }).catch(() => {});
    await uploadFilesystem.rmdir(id, { recursive: true, force: true }).catch(() => {});
    console.error('[files] upload failed', error);
    return jsonError('文件保存失败。', 500);
  }

  return Response.json(
    {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
      extension: record.extension,
      createdAt: record.createdAt,
      viewUrl: `/api/files/${record.id}`,
      downloadUrl: `/api/files/${record.id}?download=1`,
    },
    { status: 201 },
  );
}
