import { Mastra } from '@mastra/core/mastra';

import { documentAgent } from './agents/document-agent';
import { buildStyleProfileWorkflow } from './document/build-style-profile-workflow';
import { getDocumentMemoryStorage } from './memory';

function createMastra() {
  return new Mastra({
    storage: getDocumentMemoryStorage(),
    agents: { documentAgent },
    workflows: { buildStyleProfileWorkflow },
  });
}

const globalForMastra = globalThis as typeof globalThis & {
  documentAgentMastra?: ReturnType<typeof createMastra>;
};

// Mastra 实例持有 Postgres 存储，同样要等到真正被调用时再建，
// 否则构建阶段 import 这个模块就会因为缺少数据库环境变量而失败。
export function getMastra() {
  if (!globalForMastra.documentAgentMastra) {
    globalForMastra.documentAgentMastra = createMastra();
  }

  return globalForMastra.documentAgentMastra;
}
