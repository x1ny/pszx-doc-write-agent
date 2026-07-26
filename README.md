# 公文写作 Agent

基于 Next.js、Mastra、AI SDK 和 Plate 构建的公文写作工作台，包含文档编辑器和 AI 写作助手。

## 开始使用

安装依赖：\`pnpm install\`

配置 `.env.local`：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

启动开发服务器：\`pnpm dev\`

主要路由：

- `/`：文档编辑器与 AI 助手工作台
- `/editor`：独立文档编辑器
- `/api/chat`：Mastra Agent 的 AI 助手流式接口

文档内容仅保存在当前页面状态中，刷新页面后不会持久化。
