---
name: mastra-agent-cli-testing
description: Test and diagnose Mastra agents from the CLI or Node scripts, including server tools, client tools, mixed tool loops, streamed responses, environment loading, tool-call inspection, and automatic continuation. Use when testing a Mastra agent outside the browser, debugging repeated tool calls or stalled ReAct loops, validating tool inputs and outputs, or building a repeatable Agent test command.
---

# Mastra Agent CLI 测试

## 目标

使用与项目实际版本匹配的 Mastra API，验证 Agent 的工具调用顺序、工具输入输出、ReAct 续传和最终结果。先区分“服务端 CLI 冒烟测试”和“包含浏览器客户端工具的完整链路测试”，不要把两者当成同一种测试。

## 测试前检查

1. 检查 `package.json`、`node_modules/@mastra/core/package.json`、`node_modules/mastra/package.json` 的版本。优先阅读已安装包中的类型和文档，不凭记忆猜 API。
2. 检查 Agent 的注册 ID、模型配置、服务端工具和客户端工具清单。
3. 检查 `.env.local` 是否包含模型密钥、模型名称和 Base URL。Node 脚本不会自动读取 Next.js 的 `.env.local`，必须在导入 Agent 之前加载环境变量：

   ```js
   import { config } from 'dotenv';

   config({ path: '.env.local' });
   config({ path: '.env' });
   // 在这里之后再 import 或通过 jiti 加载 src/mastra
   ```

   不要打印密钥或完整环境变量，只报告变量是否存在、请求地址和非敏感的错误信息。

## 两种测试入口

### 1. Mastra CLI 冒烟测试

用于确认 Agent 已注册、服务端可访问、模型鉴权正常、服务端工具可以被调用：

```bash
mastra dev
mastra api --url http://localhost:4111 agent list
mastra api --url http://localhost:4111 agent run document-agent '{"messages":"测试请求"}'
```

在 Windows PowerShell 中，JSON 参数经常被 PowerShell 重新解释，导致 `INVALID_JSON`。遇到这种情况，使用 `cmd.exe /c` 调用 CLI，或把请求封装到项目测试脚本中，不要继续堆叠转义符。

CLI 冒烟测试的边界：Mastra Studio/CLI 进程没有 Next.js 浏览器上下文，因此不能直接执行 `getDocumentSnapshot`、`writeMarkdownToPlate` 等客户端工具。CLI 只能证明服务端 Agent 和服务端工具工作正常；不能据此断言浏览器端文档读写链路正常。

### 2. Node 测试脚本

需要验证完整链路时，使用 `jiti` 加载 TypeScript Mastra 实例，并注入模拟客户端工具：

```js
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mastra } = await jiti.import('../src/mastra/index.ts');

const result = await mastra.getAgentById('document-agent').generate(prompt, {
  maxSteps: 8,
  clientTools: {
    getDocumentSnapshot: mockSnapshotTool,
    writeMarkdownToPlate: mockWriteTool,
  },
});
```

模拟工具必须返回与浏览器工具完全一致的 schema。测试结果至少记录：

- `finishReason`
- `toolCalls` 和 `toolResults`
- `result.messages` 或 `result.steps` 中的工具调用顺序
- 最终是否调用写回工具，以及写回 Markdown 的长度

Mastra 的 `result.toolCalls` 在不同版本中可能是包装结构，不能假定字段一定是 `toolName`、`args`。发现输出为 `{}` 时使用 `console.dir(value, { depth: 8 })`，通常实际字段在 `toolCall.payload.toolName`、`toolCall.payload.args` 中。

## 客户端工具续传

`clientTools` 的调用不会由服务端 `agent.generate()` 自动执行。第一次生成常见结果是：

```text
finishReason: tool-calls
toolResults: []
tool call: getDocumentSnapshot
```

这不是模型失败，而是等待客户端返回工具结果。完整测试必须模拟浏览器的两步流程：

1. 读取工具调用参数并执行模拟客户端工具。
2. 把工具结果写回对应的 `toolCallId`。
3. 使用带有工具结果的消息再次调用 Agent。
4. 重复直到 Agent 返回最终文本或达到明确的最大续传次数。

浏览器中的 `useChat` 使用 `addToolOutput` 和 `sendAutomaticallyWhen` 完成同样的工作。测试脚本必须设置最大循环次数，例如 3～5 次；超过上限立即打印所有工具调用并失败，避免测试进程无限运行。

## 混合服务端工具与客户端工具

这是最容易误判的场景。一个模型步骤可能同时调用服务端工具和客户端工具，例如：

```text
getDocumentSnapshot                 客户端工具
simulateLeaderStyleAnalysis         服务端工具
```

注意事项：

- 服务端工具可能已经在服务端执行，但 AI SDK UI 消息中仍暂时显示 `input-available`。
- 自动续传条件不能简单要求“这一轮所有工具都必须是 `output-available`”，否则客户端工具已经返回也不会继续。
- 也不能只扫描最后一个 `step-start` 之后的工具片段。Mastra 适配后的 UI 消息可能把工具片段放在 `step-start` 之前。
- 续传判断应关注客户端工具：等待所有待处理客户端工具有结果，并按 `toolCallId` 标记已经续传过的调用。
- 如果服务端工具结果没有进入下一轮模型上下文，模型会重复调用该工具。此时应把服务端工具最终结果通过可追踪的自定义数据流同步到客户端，或在 Agent 侧强制工具顺序，确保下一轮请求包含该结果。

## 无限工具调用排查

看到界面中的进度卡片重复出现时，优先检查：

1. 服务端日志中是否出现新的 `[ReAct][request-start]`，以及每个请求的 `request-mode`。
2. 每次重复调用的 `toolCallId` 是否变化。ID 变化说明 Agent 确实被重复续传，而不是 UI 重复渲染。
3. 下一次请求的消息中，之前的工具调用是否带有工具结果。
4. 是否把服务端 `input-available` 错当成客户端待处理工具。
5. 是否缺少 `toolCallId` 去重，或每次 `addToolOutput` 都重新触发了同一个请求。

推荐的保护措施：

- 为自动续传维护 `Set<string>`，每个 `toolCallId` 只允许续传一次。
- 维护最大自动续传次数。
- 在服务端打印请求 ID、工具名、工具 ID、输入、输出、finish reason 和下一轮消息摘要；不要打印密钥。
- 当 Agent 已有最终文本且没有新的客户端工具调用时，禁止再次续传。

## 环境和安装踩坑

- 直接执行 Node 测试脚本时，未加载 `.env.local` 会导致请求落到默认 Provider 地址，常见错误是 `Authorization Required` 或 API Key 格式错误。
- `pnpm add -D mastra@latest` 可能因为正在运行的 Next 进程锁定 `node_modules/.bin/next.exe` 而失败。先停止开发进程，再重新安装；如果只需要更新锁文件，使用项目允许的 `--lockfile-only` 方案，并随后确认 CLI 实际版本。
- `mastra dev` 会生成 `.mastra` 构建目录。将 `.mastra` 加入 `.gitignore`，同时加入 ESLint 忽略，否则 `eslint .` 可能扫描大型构建产物并内存溢出。
- 兼容 Provider 出现“JSON schema compatibility mode”警告，不等于工具调用失败。应继续检查实际的 `tool-call`、schema 校验错误和 HTTP 响应。
- PowerShell 中用字符串拼 JSON 是高风险操作。优先使用 Node 测试脚本；必须调用 CLI 时，先用 `mastra api agent list` 验证服务，再单独测试 `agent run`。

## 验证完成标准

至少完成以下检查：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
git diff --check
```

然后运行一个真实 prompt，确认工具序列、最终文本和写回结果。浏览器交互仍需由用户在实际页面验证；CLI 或 Node 模拟器只能验证 Agent 和工具协议，不能替代真实编辑器状态验证。
