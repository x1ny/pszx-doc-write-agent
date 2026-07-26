import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';

import { mastra } from '@/mastra';
import { clientTools } from '@/mastra/tools/document-tools';

export const runtime = 'nodejs';

function formatDebugValue(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function POST(request: Request) {
  const params = await request.json();
  const requestId = crypto.randomUUID();

  console.log(`\n[ReAct][request-start] ${requestId}`);
  console.log(
    `[ReAct][request-mode] ${params.resumeData && params.runId ? 'resume' : 'initial'}`
  );
  console.log('[ReAct][request-params]', JSON.stringify(params, null, 2));

  const stream = await handleChatStream({
    mastra,
    agentId: 'document-agent',
    params: {
      ...params,
      clientTools,
      maxSteps: 5,
      onStepFinish: (step: unknown) => {
        console.log(`[ReAct][step-finish] ${requestId}`);
        console.log('[ReAct][step]', formatDebugValue(step));
      },
      onFinish: (result: unknown) => {
        console.log(`[ReAct][request-finish] ${requestId}`);
        console.log('[ReAct][finish]', formatDebugValue(result));
      },
    },
    onError: (error) => {
      console.error(`[ReAct][stream-error] ${requestId}`);
      console.error(formatDebugValue(error));
      return error instanceof Error ? error.message : String(error);
    },
  });

  console.log(`[ReAct][stream-created] ${requestId}`);

  return createUIMessageStreamResponse({
    stream: stream as unknown as Parameters<
      typeof createUIMessageStreamResponse
    >[0]['stream'],
  });
}
