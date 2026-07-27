import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

export const documentMemoryStorage = new LibSQLStore({
  id: 'document-agent-memory',
  url: 'file:./mastra.db',
});

export const documentMemory = new Memory({
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
