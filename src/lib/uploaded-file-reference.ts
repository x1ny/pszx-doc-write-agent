const fileIdPattern =
  /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#]|$)/i;

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

export function getUploadedFileViewUrl(fileId: string) {
  return `/api/files/${fileId}`;
}

type UnknownPart = { type?: unknown; [key: string]: unknown };
type UnknownMessage = { id?: unknown; parts?: unknown };
type StoredMessageLike = {
  id?: unknown;
  content?: { parts?: unknown } | null;
};

function getParts(value: unknown): UnknownPart[] {
  return Array.isArray(value) ? (value as UnknownPart[]) : [];
}

function getStoredFileInfo(part: UnknownPart) {
  const fileId = extractUploadedFileId(part.data ?? part.url);

  if (!fileId) return undefined;

  return {
    fileId,
    filename: typeof part.filename === 'string' ? part.filename : undefined,
    mediaType:
      typeof part.mediaType === 'string'
        ? part.mediaType
        : typeof part.mimeType === 'string'
          ? part.mimeType
          : undefined,
  };
}

/**
 * `toAISdkMessages` 把存储态 file part 的 `data` 当成 base64 正文，
 * 会拼出 `data:<mime>;base64,/api/files/<id>` 这种打不开的地址，并且丢掉 filename。
 * 这里用原始存储消息把这两项还原回去，让历史记录里的文件卡片可点、有名字。
 */
export function restoreUploadedFilePartsFromStored<T extends UnknownMessage>(
  uiMessages: T[],
  storedMessages: StoredMessageLike[],
): T[] {
  const storedById = new Map<string, UnknownPart[]>();

  for (const message of storedMessages) {
    if (typeof message?.id === 'string') {
      storedById.set(message.id, getParts(message.content?.parts));
    }
  }

  return uiMessages.map((message) => {
    const parts = getParts(message.parts);

    if (!parts.some((part) => part.type === 'file')) {
      return message;
    }

    const storedFiles = getParts(
      typeof message.id === 'string' ? storedById.get(message.id) : undefined,
    )
      .filter((part) => part.type === 'file')
      .flatMap((part) => {
        const info = getStoredFileInfo(part);
        return info ? [info] : [];
      });
    let fileIndex = 0;

    return {
      ...message,
      parts: parts.map((part) => {
        if (part.type !== 'file') return part;

        // 优先按 URL 里残留的文件 ID 匹配，取不到再按出现顺序回退。
        const fileId = extractUploadedFileId(part.url ?? part.data);
        const stored =
          storedFiles.find((file) => file.fileId === fileId) ??
          storedFiles[fileIndex];

        fileIndex += 1;

        if (!stored) return part;

        return {
          ...part,
          url: getUploadedFileViewUrl(stored.fileId),
          ...(stored.filename ? { filename: stored.filename } : {}),
          ...(stored.mediaType ? { mediaType: stored.mediaType } : {}),
        };
      }),
    };
  });
}
