import "server-only"

import { getMastra } from "@/mastra"

export async function getDocumentAgentMemory() {
  const memory = await getMastra().getAgentById("document-agent").getMemory()

  if (!memory) {
    throw new Error("document-agent 未配置 Memory")
  }

  return memory
}
