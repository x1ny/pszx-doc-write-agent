import "server-only"

import { mastra } from "@/mastra"

export async function getDocumentAgentMemory() {
  const memory = await mastra.getAgentById("document-agent").getMemory()

  if (!memory) {
    throw new Error("document-agent 未配置 Memory")
  }

  return memory
}
