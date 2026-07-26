import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse } from 'ai'
import { NextResponse } from 'next/server'

import { mastra } from '@/mastra'

const RESOURCE_ID = 'weather-chat'

export async function POST(req: Request) {
  const { threadId, ...params } = await req.json()
  const currentThreadId = threadId || crypto.randomUUID()

  const stream = await handleChatStream({
    mastra,
    agentId: 'weather-agent',
    params: {
      ...params,
      memory: {
        ...params.memory,
        thread: currentThreadId,
        resource: RESOURCE_ID,
      },
    },
  })

  return createUIMessageStreamResponse({
    stream: stream as unknown as Parameters<typeof createUIMessageStreamResponse>[0]['stream'],
  })
}

export async function GET(req: Request) {
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  const threadId = new URL(req.url).searchParams.get('threadId')

  if (!threadId) {
    return NextResponse.json([])
  }

  let response = null

  try {
    response = await memory?.recall({
      threadId,
      resourceId: RESOURCE_ID,
    })
  } catch {
    console.log('No previous messages found.')
  }

  const uiMessages = toAISdkV5Messages(response?.messages || [])

  return NextResponse.json(uiMessages)
}
