import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

import { getDatabaseConnectionConfig } from '@/db/environment';

const globalForDocumentMemory = globalThis as typeof globalThis & {
  documentAgentMemory?: Memory;
  documentAgentPgStore?: PostgresStore;
};

// 存储与 Memory 延迟创建：next build 收集路由信息时会 import 到这里，
// 构建阶段没有数据库环境变量，顶层读取会直接让构建失败。
export function getDocumentMemoryStorage() {
  if (!globalForDocumentMemory.documentAgentPgStore) {
    globalForDocumentMemory.documentAgentPgStore = new PostgresStore({
      id: 'document-agent-memory',
      ...getDatabaseConnectionConfig(),
    });
  }

  return globalForDocumentMemory.documentAgentPgStore;
}

export function getDocumentMemory() {
  if (!globalForDocumentMemory.documentAgentMemory) {
    globalForDocumentMemory.documentAgentMemory = new Memory({
      storage: getDocumentMemoryStorage(),
      options: {
        lastMessages: 10,
        workingMemory: {
          enabled: true,
          scope: 'resource',
          template: `# 用户写作偏好

## 写作风格
- 常用公文风格：
- 常用领导或作者风格：
- 语言语气：

## 内容与结构偏好
- 结构偏好：
- 数据使用偏好：
- 常用表达：
- 避免使用的表达：

## 长期目标
- 用户长期写作目标：
- 其他需要长期遵循的偏好：`,
        },
      },
    });
  }

  return globalForDocumentMemory.documentAgentMemory;
}
