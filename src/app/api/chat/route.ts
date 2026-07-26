import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';

import { mastra } from '@/mastra';
import { clientTools } from '@/mastra/tools/document-tools';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const params = await request.json();

  const stream = await handleChatStream({
    mastra,
    agentId: 'document-agent',
    params: {
      ...params,
      clientTools,
      maxSteps: 5,
    },
  });

  return createUIMessageStreamResponse({
    stream: stream as unknown as Parameters<
      typeof createUIMessageStreamResponse
    >[0]['stream'],
  });
}
