import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';

import { mastra } from '@/mastra';
import { clientTools } from '@/mastra/document/tools';
import {
  shouldKeepWorkingMemoryReadOnly,
  shouldUseWorkingMemoryStyleRewrite,
  workingMemoryStyleActiveTools,
} from '@/lib/style-routing';

export const runtime = 'nodejs';

function getLatestUserText(messages: unknown) {
  if (!Array.isArray(messages)) {
    return '';
  }

  const latestUserMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'user'
    );

  if (!latestUserMessage || typeof latestUserMessage !== 'object') {
    return '';
  }

  if ('content' in latestUserMessage && typeof latestUserMessage.content === 'string') {
    return latestUserMessage.content;
  }

  if (!('parts' in latestUserMessage) || !Array.isArray(latestUserMessage.parts)) {
    return '';
  }

  return latestUserMessage.parts
    .filter(
      (part: unknown): part is { type: string; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string'
    )
    .map((part: { type: string; text: string }) => part.text)
    .join('');
}

export async function POST(request: Request) {
  const params = await request.json();
  const latestUserText = getLatestUserText(params.messages);
  const useWorkingMemoryStyle = shouldUseWorkingMemoryStyleRewrite(latestUserText);
  const keepWorkingMemoryReadOnly = shouldKeepWorkingMemoryReadOnly(latestUserText);

  const stream = await handleChatStream({
    mastra,
    agentId: 'document-agent',
    params: {
      ...params,
      clientTools,
      maxSteps: 5,
      ...(keepWorkingMemoryReadOnly
        ? {
            memory: {
              ...(params.memory ?? {}),
              options: {
                ...(params.memory?.options ?? {}),
                readOnly: true,
              },
            },
          }
        : {}),
      ...(useWorkingMemoryStyle
        ? {
            activeTools: workingMemoryStyleActiveTools,
            system:
              '本轮必须使用 Working Memory 中已经保存的写作风格完成改写。不要调用 simulateLeaderStyleAnalysis，也不要猜测或学习任何人物风格。',
          }
        : {}),
    },
    onError: (error) =>
      error instanceof Error ? error.message : String(error),
  });

  return createUIMessageStreamResponse({
    stream: stream as unknown as Parameters<
      typeof createUIMessageStreamResponse
    >[0]['stream'],
  });
}
