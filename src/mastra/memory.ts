import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

const globalForDocumentMemory = globalThis as typeof globalThis & {
  documentAgentMemory?: Memory;
  documentAgentPgStore?: PostgresStore;
};

function getRequiredDatabaseEnvironment(
  key: 'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASSWORD',
) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required database environment variable: ${key}`);
  }

  return value;
}

function getDatabasePort() {
  const value = getRequiredDatabaseEnvironment('DB_PORT');
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }

  return port;
}

export const documentMemoryStorage =
  globalForDocumentMemory.documentAgentPgStore ??
  new PostgresStore({
    id: 'document-agent-memory',
    host: getRequiredDatabaseEnvironment('DB_HOST'),
    port: getDatabasePort(),
    database: getRequiredDatabaseEnvironment('DB_NAME'),
    user: getRequiredDatabaseEnvironment('DB_USER'),
    password: getRequiredDatabaseEnvironment('DB_PASSWORD'),
  });

globalForDocumentMemory.documentAgentPgStore = documentMemoryStorage;

export const documentMemory =
  globalForDocumentMemory.documentAgentMemory ??
  new Memory({
    storage: documentMemoryStorage,
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

globalForDocumentMemory.documentAgentMemory = documentMemory;
