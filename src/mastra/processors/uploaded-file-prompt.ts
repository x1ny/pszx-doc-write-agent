import mammoth from 'mammoth';
import type {
  ProcessInputStepArgs,
  ProcessOutputStepArgs,
  Processor,
} from '@mastra/core/processors';

import {
  documentWorkspace,
  getMetadataPath,
  type UploadedFileRecord,
} from '@/lib/file-workspace';

const fileIdPattern =
  /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#]|$)/i;

export type UploadedFileTextReader = (fileId: string) => Promise<string>;

type StoredMessage = ProcessInputStepArgs['messages'][number];
type StoredPart = StoredMessage['content']['parts'][number];
type StoredTextPart = Extract<StoredPart, { type: 'text' }>;
type StoredFilePart = Extract<StoredPart, { type: 'file' }>;
type ProcessorState = {
  originalMessages?: Map<string, StoredMessage>;
};

function isStoredTextPart(part: StoredPart): part is StoredTextPart {
  return part.type === 'text';
}

function isStoredFilePart(part: StoredPart): part is StoredFilePart {
  return part.type === 'file';
}

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getFileReference(data: unknown) {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof URL) {
    return data.toString();
  }

  if (typeof data === 'object' && data !== null) {
    const value = data as { type?: unknown; url?: unknown };

    if (value.type === 'url' && typeof value.url === 'string') {
      return value.url;
    }

    if (value.type === 'url' && value.url instanceof URL) {
      return value.url.toString();
    }
  }

  return undefined;
}

export function extractUploadedFileId(data: unknown) {
  const reference = getFileReference(data);
  return reference ? reference.match(fileIdPattern)?.[1] : undefined;
}

function getStoredFileReference(part: StoredFilePart) {
  const value = part as StoredFilePart & {
    data?: unknown;
    filename?: unknown;
    mediaType?: unknown;
    mimeType?: unknown;
    url?: unknown;
  };
  return extractUploadedFileId(value.data ?? value.url);
}

export function formatAttachedFileContext(
  files: Array<{
    id: string;
    filename?: string;
    mediaType: string;
    text: string;
  }>,
) {
  return [
    '<attached_files>',
    ...files.map(
      (file) =>
        [
          `  <file id="${escapeXmlAttribute(file.id)}" name="${escapeXmlAttribute(file.filename || '未命名文件')}" media_type="${escapeXmlAttribute(file.mediaType)}">`,
          '    <content>',
          file.text,
          '    </content>',
          '  </file>',
        ].join('\n'),
    ),
    '</attached_files>',
  ].join('\n');
}

async function parseUploadedFileRecord(fileId: string) {
  await documentWorkspace.init();
  const metadata = await documentWorkspace.filesystem.readFile(
    getMetadataPath(fileId),
    { encoding: 'utf8' },
  );
  const record = JSON.parse(String(metadata)) as Partial<UploadedFileRecord>;

  if (
    record.id !== fileId ||
    typeof record.extension !== 'string' ||
    typeof record.contentPath !== 'string' ||
    !record.contentPath.startsWith(`${fileId}/`)
  ) {
    throw new Error(`上传文件元数据无效：${fileId}`);
  }

  return record as UploadedFileRecord;
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
    return new TextDecoder('gb18030').decode(buffer);
  }
}

export async function readUploadedFileText(fileId: string) {
  const record = await parseUploadedFileRecord(fileId);
  const content = await documentWorkspace.filesystem.readFile(
    record.contentPath,
  );
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  if (record.extension === '.docx') {
    return (await mammoth.extractRawText({ buffer })).value;
  }

  return decodeText(buffer);
}

export async function transformStoredMessagesWithUploadedFiles(
  messages: StoredMessage[],
  readFileText: UploadedFileTextReader,
  originalMessages?: Map<string, StoredMessage>,
) {
  let changed = false;
  const nextMessages: StoredMessage[] = [];

  for (const message of messages) {
    const parts = message.content?.parts ?? [];
    const fileParts = parts.filter(isStoredFilePart);

    if (fileParts.length === 0) {
      nextMessages.push(message);
      continue;
    }

    const files = await Promise.all(
      fileParts.map(async (part) => {
        const fileInfo = part as StoredFilePart & {
          filename?: unknown;
          mediaType?: unknown;
          mimeType?: unknown;
        };
        const fileId = getStoredFileReference(part);

        if (!fileId) {
          throw new Error(
            `无法从附件引用中解析文件 ID：${typeof fileInfo.filename === 'string' ? fileInfo.filename : '未命名文件'}`,
          );
        }

        return {
          id: fileId,
          filename:
            typeof fileInfo.filename === 'string'
              ? fileInfo.filename
              : undefined,
          mediaType:
            typeof fileInfo.mediaType === 'string'
              ? fileInfo.mediaType
              : typeof fileInfo.mimeType === 'string'
                ? fileInfo.mimeType
                : 'text/plain',
          text: await readFileText(fileId),
        };
      }),
    );

    originalMessages?.set(message.id, message);

    const requestText = parts
      .filter(isStoredTextPart)
      .map((part) => part.text)
      .join('\n');
    const sections = [formatAttachedFileContext(files)];

    if (requestText.trim()) {
      sections.push(
        ['<user_request>', requestText, '</user_request>'].join('\n'),
      );
    }

    const otherParts = parts.filter(
      (part) => !isStoredTextPart(part) && !isStoredFilePart(part),
    );

    nextMessages.push({
      ...message,
      content: {
        ...message.content,
        parts: [
          {
            type: 'text',
            text: sections.join('\n\n'),
          },
          ...otherParts,
        ],
      },
    });
    changed = true;
  }

  return changed ? nextMessages : undefined;
}

export class UploadedFilePromptProcessor implements Processor {
  readonly id = 'uploaded-file-prompt';

  private readonly originalMessages = new Map<string, StoredMessage>();

  constructor(
    private readonly readFileText: UploadedFileTextReader = readUploadedFileText,
  ) {}

  async processInputStep({ messages, state }: ProcessInputStepArgs) {
    const processorState = state as ProcessorState;
    const originalMessages =
      processorState.originalMessages ?? new Map<string, StoredMessage>();
    processorState.originalMessages = originalMessages;

    const transformedMessages = await transformStoredMessagesWithUploadedFiles(
      messages,
      this.readFileText,
      originalMessages,
    );

    for (const message of messages) {
      if (originalMessages.has(message.id)) {
        this.originalMessages.set(message.id, message);
      }
    }
    return transformedMessages ? { messages: transformedMessages } : {};
  }

  processOutputStep({ messages, finishReason }: ProcessOutputStepArgs) {
    const restoredMessages = messages.map(
      (message) => this.originalMessages.get(message.id) ?? message,
    );

    if (finishReason !== 'tool-calls') {
      for (const message of restoredMessages) {
        this.originalMessages.delete(message.id);
      }
    }

    return restoredMessages;
  }
}
