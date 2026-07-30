import {
  getMetadataPath,
  uploadFilesystem,
  type UploadedFileRecord,
} from '@/lib/file-workspace';
import mammoth from 'mammoth';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isTextFile(extension: string) {
  return extension === '.txt' || extension === '.md' || extension === '.markdown';
}

function decodeText(buffer: Buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Windows 中文文本常见 GBK/GB18030 编码，统一转成 UTF-8 返回给浏览器。
    return new TextDecoder('gb18030').decode(buffer);
  }
}

function parseRecord(value: unknown): UploadedFileRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Partial<UploadedFileRecord>;

  if (
    typeof record.id !== 'string' ||
    typeof record.originalName !== 'string' ||
    typeof record.mimeType !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.extension !== 'string' ||
    typeof record.contentPath !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null;
  }

  return record as UploadedFileRecord;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;

  if (!isUuid(id)) {
    return jsonError('文件 ID 无效。', 400);
  }

  try {
    await uploadFilesystem.init();
    const metadataPath = getMetadataPath(id);

    if (!(await uploadFilesystem.exists(metadataPath))) {
      return jsonError('文件不存在。', 404);
    }

    const metadataContent = await uploadFilesystem.readFile(metadataPath, {
      encoding: 'utf8',
    });
    const record = parseRecord(JSON.parse(String(metadataContent)));

    if (!record || record.id !== id || !record.contentPath.startsWith(`${id}/`)) {
      return jsonError('文件元数据无效。', 500);
    }

    // 不指定 encoding，让 Mastra 返回 Buffer，保留上传文件的原始字节。
    // 如果先按 binary 读成字符串，再 Buffer.from(string)，中文 UTF-8 会被重新编码而损坏。
    const content = await uploadFilesystem.readFile(record.contentPath);
    const query = new URL(request.url).searchParams;

    if (query.get('preview') === '1') {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const previewContent =
        record.extension === '.docx'
          ? (await mammoth.extractRawText({ buffer })).value
          : decodeText(buffer);

      return new Response(previewContent, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(previewContent, 'utf8')),
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const download = query.get('download') === '1';
    const disposition = download ? 'attachment' : 'inline';
    const responseBody =
      !download && isTextFile(record.extension)
        ? decodeText(Buffer.isBuffer(content) ? content : Buffer.from(content))
        : typeof content === 'string'
          ? content
          : new Uint8Array(content);
    const contentType = isTextFile(record.extension)
      ? `${record.mimeType.startsWith('text/') ? record.mimeType : 'text/plain'}; charset=utf-8`
      : record.mimeType;

    return new Response(responseBody, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(
          typeof responseBody === 'string'
            ? Buffer.byteLength(responseBody, 'utf8')
            : responseBody.byteLength,
        ),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[files] read failed', error);
    return jsonError('文件读取失败。', 500);
  }
}
