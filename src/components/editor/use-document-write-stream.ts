'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useDocumentEditor } from '@/components/editor/document-editor-context';

export type StreamDocumentInput = {
  instruction: string;
  mode: 'create-document' | 'replace-document';
  styleProfile?: string;
};

async function readErrorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  return body?.error || `文档生成失败（HTTP ${response.status}）`;
}

export function useDocumentWriteStream() {
  const {
    abortDocumentStream,
    appendDocumentStream,
    beginDocumentStream,
    commitDocumentStream,
    isDocumentStreaming,
    readDocument,
    revealEditor,
  } = useDocumentEditor();
  const activeRequestRef = useRef<AbortController | null>(null);

  const runDocumentStream = useCallback(
    async (
      operationId: string,
      consume: (signal: AbortSignal) => Promise<void>
    ) => {
      revealEditor();

      const abortController = new AbortController();
      beginDocumentStream(operationId);
      activeRequestRef.current = abortController;

      try {
        await consume(abortController.signal);
        commitDocumentStream(operationId);
      } catch (error) {
        abortDocumentStream(operationId);
        throw error;
      } finally {
        if (activeRequestRef.current === abortController) {
          activeRequestRef.current = null;
        }
      }
    },
    [
      abortDocumentStream,
      beginDocumentStream,
      commitDocumentStream,
      revealEditor,
    ]
  );

  const streamDocument = useCallback(
    async (operationId: string, input: StreamDocumentInput) => {
      const snapshot = readDocument();
      const sourceMarkdown =
        input.mode === 'create-document' ? '' : snapshot?.markdown;

      if (input.mode === 'replace-document' && !sourceMarkdown?.trim()) {
        throw new Error('当前文档为空，无法执行整篇改写');
      }

      await runDocumentStream(operationId, async (signal) => {
        const response = await fetch('/api/document-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            sourceMarkdown: sourceMarkdown ?? '',
          }),
          signal,
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        if (!response.body) {
          throw new Error('文档生成接口没有返回可读取的文本流');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            const chunk = decoder.decode(value, { stream: true });

            if (chunk) {
              appendDocumentStream(operationId, chunk);
            }
          }

          const finalChunk = decoder.decode();

          if (finalChunk) {
            appendDocumentStream(operationId, finalChunk);
          }
        } finally {
          reader.releaseLock();
        }
      });
    },
    [appendDocumentStream, readDocument, runDocumentStream]
  );

  const writePreparedMarkdown = useCallback(
    async (operationId: string, markdown: string) => {
      await runDocumentStream(operationId, async (signal) => {
        const chunkSize = 256;

        for (let offset = 0; offset < markdown.length; offset += chunkSize) {
          if (signal.aborted) {
            throw new DOMException('文档写入已停止', 'AbortError');
          }

          appendDocumentStream(
            operationId,
            markdown.slice(offset, offset + chunkSize)
          );

          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
        }
      });
    },
    [appendDocumentStream, runDocumentStream]
  );

  const stopDocumentWrite = useCallback(() => {
    activeRequestRef.current?.abort();
    abortDocumentStream();
  }, [abortDocumentStream]);

  useEffect(() => stopDocumentWrite, [stopDocumentWrite]);

  return {
    isDocumentStreaming,
    stopDocumentWrite,
    streamDocument,
    writePreparedMarkdown,
  };
}
