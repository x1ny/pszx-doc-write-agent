import { handleChatStream } from '@mastra/ai-sdk';
import type { AlibabaLanguageModelOptions } from '@ai-sdk/alibaba';
import { createUIMessageStreamResponse } from 'ai';

import { getMastra } from '@/mastra';
import { clientTools } from '@/mastra/document/tools';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const params = await request.json();

  const stream = await handleChatStream({
    mastra: getMastra(),
    agentId: 'document-agent',
    params,
    defaultOptions: {
      clientTools,
      maxSteps: 10,
      providerOptions: {
        alibaba: {
          parallelToolCalls: false,
        } satisfies AlibabaLanguageModelOptions,
      },
    },
    version: 'v6',
    onError: (error) =>
      error instanceof Error ? error.message : String(error),
  });

  return createUIMessageStreamResponse({ stream });
}
