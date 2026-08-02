# Agent、Workflow 与客户端工具续传冲突：故障复盘与架构指南

> 文档状态：架构复盘 / 后续改造依据
>
> 调查日期：2026-08-02
>
> 适用范围：本文所记录的结论首先适用于本项目当前安装的版本，升级依赖后必须重新核对版本自带文档和源码。

> **评审修订（第二版）**：初稿曾建议把材料选择移出 Workflow；第一轮修订又建议增加 `buildStyleProfileInteractively` 客户端门面，由浏览器启动独立 Workflow。进一步核对当前安装版本的 Mastra 文档和源码后确认，这两种方案都不是本项目的首选。Mastra 已原生实现“Workflow-as-Tool 挂起后提升为 Agent suspension、恢复 Agent run 时继续原 Workflow”的桥接。本文最终结论是：保留 Workflow HITL，让 Agent 直接调用 Mastra 自动生成的 Workflow 工具；浏览器只展示挂起状态并恢复 Agent run，不再增加客户端门面工具。独立 Workflow endpoint 仅保留给“Workflow 本身就是应用入口”的场景。

## 1. 摘要

这次故障表面上表现为：

- 用户要求按“李局长”的风格改写文章后，Agent 只回复“先分析写作风格，再进行改写”，随后停止；
- `getDocumentSnapshot` 出现工具调用，却看不到工具结果；
- 浏览器连续发送了两个带相同 `runId` 的请求；
- 服务端最终报错 `AGENT_RESUME_NO_SNAPSHOT_FOUND`；
- 为了让链路继续执行，项目逐渐增加了消息扫描、防重 `ref`、`requestKind`、请求体清洗、自定义自动续传条件和提示词串行限制。

调查后的核心结论是：

> 问题不是 Agent 不会连续调用工具，也不是 Workflow 不能作为工具使用，而是我们把 AI SDK 的客户端工具续传协议和 Mastra 的挂起恢复协议叠加在了同一次 `useChat` 请求上。

这两套协议分别都是官方能力，但它们表达的是两种不同的“继续执行”：

- AI SDK：客户端工具已经产生结果，请把工具结果重新提交给模型；
- Mastra：某个已经持久化的挂起运行现在获得了恢复数据，请从快照继续执行。

当前实现让一个请求同时携带这两种含义。框架无法替应用判断当前的 `runId` 和 `resumeData` 是新的恢复命令，还是自动续传时遗留的旧请求体，于是发生重复恢复。

推荐处理方向：

1. 保留 `buildStyleProfileWorkflow` 的完整确定性流程，包括材料检索、用户选择、`suspend/resume`、分析和汇总；
2. 继续把 Workflow 注册在 Agent 的 `workflows` 中，由 Mastra 暴露为 `workflow-buildStyleProfileWorkflow`，不新增 `buildStyleProfileInteractively` 客户端工具；
3. Workflow 到达 `selectStyleReferences` 后继续使用 `suspend()`；浏览器只渲染 `tool-call-suspended`，并把结构化选择结果一次性提交给 **Agent run**；
4. 由 Mastra 的 Workflow-as-Tool 包装层恢复原 Workflow，完成加载、分析和汇总，再把最终结果作为原 Workflow 工具结果交还 Agent；
5. 把 `runId` / `resumeData` 视为一次性 Agent 恢复命令。后续客户端工具结果如果需要继续提交，必须是一个不携带旧恢复字段的普通 Agent 请求；
6. 对齐 AI SDK 与 `@mastra/ai-sdk` 的公开版本合同，先用受支持组合验证原生链路，再决定是否需要一个最小、局部的 Transport 适配；不得再通过 UI transcript 扫描推断快照是否已消费。

快速阅读建议：先看第 6 节的精确根因、第 10 节的目标架构、第 17 节的迁移顺序和第 21 节的设计经验；其余章节可作为实现和排障手册查阅。

## 2. 调查时的项目状态

调查时安装的核心版本为：

| 依赖 | 版本 |
| --- | --- |
| `ai` | `7.0.37` |
| `@ai-sdk/react` | `4.0.40` |
| `@mastra/core` | `1.52.1` |
| `@mastra/ai-sdk` | `1.6.3` |

以上版本是事故调查时的状态，不是当前实现基线。

### 2.1 当前官方基线（2026-08-02）

本次按“先回到受支持合同，再观察框架真实行为”的原则调整为：

| 依赖 | 版本 |
| --- | --- |
| `ai` | `6.0.240` |
| `@ai-sdk/react` | `3.0.242` |
| `@ai-sdk/deepseek` | `2.0.51` |
| `@mastra/core` | `1.52.1` |
| `@mastra/ai-sdk` | `1.6.3` |

`handleChatStream()` 现在显式使用 `version: 'v6'`，并直接把返回流交给 `createUIMessageStreamResponse()`；原来的双重类型断言已经删除。客户端恢复为 AI SDK 官方示例：`onToolCall` 执行客户端工具，`addToolOutput` 回传结果，`lastAssistantMessageIsCompleteWithToolCalls` 决定自动续传。

本轮有意删除了 `requestKind`、请求 body 归一化、消息裁剪、transcript 扫描和自定义自动续传判断。即使旧 `runId` 继承问题仍可复现，也先保留可复现的官方基线，不再提前叠加补丁。

与问题直接相关的实现包括：

- `src/components/agent-chat.tsx`
  - `useChat`
  - `DefaultChatTransport`
  - `onToolCall`
  - `addToolOutput`
  - `sendAutomaticallyWhen`
  - Workflow/工具挂起后的确认 UI
- `src/app/api/chat/route.ts`
  - `handleChatStream`
  - `runId` / `resumeData` 转发
  - 重复恢复兜底判断
- `src/lib/chat-request.ts`
  - `requestKind`
  - 请求体归一化
  - 扫描消息判断是否已经越过挂起点
- `src/mastra/document/build-style-profile-workflow.ts`
  - 风格材料检索
  - 用户选择步骤 `suspend()`
  - 并行分析和汇总
- `src/mastra/document/article-outline.ts`
  - 服务端生成大纲
  - 在同一个工具内 `suspend()` 等待用户编辑
- `src/mastra/document/editor-tools.ts`
  - 服务端和客户端编辑器工具定义

本文描述的是调查时的代码，不应把其中的临时补丁继续视为目标架构。

## 3. 原本期望的业务链路

用户的目标其实很自然：

```text
用户要求按某位领导的风格改写
  ↓
查找风格参考材料
  ↓
用户选择材料
  ↓
分析并汇总写作风格
  ↓
读取当前文档
  ↓
改写
  ↓
写入浏览器编辑器
```

复杂度并不来自这七个业务步骤，而来自每一步跨越了不同的执行边界：

```text
浏览器 UI
  ↕ AI SDK UIMessage / 客户端工具
Next.js Chat Route
  ↕ @mastra/ai-sdk 适配层
Mastra Agent
  ↕ Workflow-as-Tool / Server Tool
Mastra Workflow
  ↕ suspend / resume 快照
```

如果没有明确每一层负责什么，业务步骤就会逐渐变成由消息历史、请求体字段和 React 生命周期共同驱动的隐式状态机。

## 4. 必须先区分的概念

### 4.1 Agent、Tool 和 Workflow 的关系

从 Agent 的视角看，注册在 `workflows` 中的 Mastra Workflow 会被包装为名为 `workflow-<key>` 的工具。因此：

> Workflow 对 Agent 来说可以表现为 Tool，但 Workflow 内部仍然拥有步骤、状态、并发、快照和恢复语义。

“外层看起来都是 Tool”不代表它们拥有相同的生命周期。

| 能力 | 决策者 | 执行位置 | 是否可能跨请求 |
| --- | --- | --- | --- |
| 服务端 Tool | Agent | 服务端 | 通常不跨请求 |
| 客户端 Tool | Agent，浏览器负责执行 | 浏览器 | 需要把结果提交回服务端 |
| Workflow-as-Tool | Agent | 服务端 Workflow 引擎 | 可以跨步骤，也可以挂起 |
| Workflow `suspend()` | Workflow/Tool | 持久化运行快照 | 明确跨请求 |

### 4.2 项目中几种容易混淆的 ID

| 标识 | 含义 | 不应该被当成什么 |
| --- | --- | --- |
| Chat ID | `useChat` 的 UI 会话标识 | Workflow run ID |
| `thread` / `resource` | Mastra Memory 的历史范围 | 单次模型运行 ID |
| `messageId` | 一条 UI 消息的标识 | 工具调用标识 |
| `toolCallId` | 一次具体工具调用的标识 | Workflow run ID |
| `runId` | Mastra Agent/Workflow 某次运行及其挂起快照标识 | 可以反复执行的普通会话 ID |

同一个 `runId` 出现在“挂起事件”和随后唯一一次“恢复请求”中是正常的。已经成功恢复后，再次用同一个恢复数据调用 `resumeStream()`，通常就不正常。

Workflow 作为 Agent 工具时，内部可能同时存在顶层 `agentRunId` 和嵌套 `workflowRunId`。当前 UI 通过 Agent suspension 恢复时，应把 suspension 事件提供的 Agent run 标识交给 Agent 恢复入口；不要把两种 ID 互换，也不要在浏览器自行创建和关联另一条 Workflow run。嵌套 ID 应由 Mastra 包装层和服务端 trace 管理。

### 4.3 三种不同的 resume

项目中至少存在三种语义完全不同的“恢复”：

1. AI SDK 客户端工具续传：把 `addToolOutput()` 产生的工具结果重新提交给模型；
2. AI SDK 流重连：网络中断后重新连接尚未完成的响应流；
3. Mastra `agent.resumeStream()` / Workflow `resumeStream()`：从已持久化的挂起快照继续业务运行。

名字相似不代表可以共用请求字段。尤其不能把 Mastra 的 `runId` / `resumeData` 当作普通 Chat 每次自动续传都应该保留的会话元数据。

AI SDK 的 `WorkflowChatTransport` 也不是本问题的解决方案。它服务于 Vercel Workflow SDK 的流中断重连，依赖 `x-workflow-run-id` 和专门的流重连端点，不负责恢复 Mastra 的人机交互快照。

## 5. 官方分别保证了什么

### 5.1 AI SDK 的客户端工具标准流程

AI SDK 官方把工具分为：

- 有 `execute` 的服务端工具；
- 由 `onToolCall` 自动执行的客户端工具；
- 需要用户交互后再返回结果的客户端工具。

客户端工具的标准流程是：

```text
模型输出客户端 tool call
  ↓
浏览器在 onToolCall 中自动执行，或渲染交互 UI
  ↓
addToolOutput({ toolCallId, output })
  ↓
如果模型必须读取结果后继续：
  lastAssistantMessageIsCompleteWithToolCalls
    ↓
  useChat 自动提交工具结果
    ↓
  模型继续推理
如果它是终端 UI 动作：
  记录工具结果并结束本轮，不必自动再请求模型
```

需要模型继续推理时，典型配置应接近：

```ts
useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
  onToolCall({ toolCall }) {
    if (toolCall.dynamic) return;

    if (toolCall.toolName === 'writeMarkdownToPlate') {
      writeMarkdown(toolCall.input.markdown);
      addToolOutput({
        tool: 'writeMarkdownToPlate',
        toolCallId: toolCall.toolCallId,
        output: { success: true },
      });
    }
  },
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
});
```

官方特别强调：

- 每一个客户端工具调用最终都必须有对应结果；
- 客户端工具失败时也应使用 `output-error` 返回错误结果；
- 不要在 `onToolCall` 内 `await addToolOutput()`，以免形成等待死锁；
- `sendAutomaticallyWhen` 是一个“是否再提交一轮”的条件，不是工具执行器；
- `lastAssistantMessageIsCompleteWithToolCalls` 会检查最后一个 assistant step 中，非 provider 执行的工具是否都已经有结果。

因此，`sendAutomaticallyWhen` 不是所有客户端工具都必须启用的固定配置。是否再次请求模型属于工具语义；即使不续传，也仍要调用 `addToolOutput()`，避免消息中留下缺失结果的工具调用。

### 5.2 Mastra Agent Chat 的标准入口

Mastra 为 Agent Chat 提供 `chatRoute()` 或框架无关的 `handleChatStream()`。普通请求应包含消息和执行配置，由适配层调用：

```text
agent.stream(messages, options)
```

如果请求明确包含 `resumeData`，当前适配层会选择：

```text
agent.resumeStream(resumeData, { runId, ...options })
```

也就是说，Mastra 的选择规则是确定性的：

```text
存在 resumeData → 恢复挂起运行
不存在 resumeData → 正常 Agent stream
```

它不会、也无法推断 `resumeData` 是刚刚由用户提交的，还是另一个框架自动续传时沿用的旧值。

这不意味着“Agent Chat 不应该恢复挂起运行”。恰恰相反，`handleChatStream()` 接收 `runId` / `resumeData` 并调用 `agent.resumeStream()`，就是 Mastra 提供的正式 Agent suspension 恢复入口。真正的约束是：

> 一次请求只能表达一种意图。显式 Agent 恢复请求可以携带 `runId` / `resumeData`，但这些字段不能被随后完全不同的客户端工具续传请求继承。

#### 5.2.1 Workflow-as-Tool 已包含原生挂起桥接

当 Workflow 注册在 Agent 的 `workflows` 中时，Mastra 会把它转换成 `workflow-<key>` 工具。当前安装版本的实现不只是“启动 Workflow”，还负责完整的 suspension 传播：

```text
Agent 调用 workflow-buildStyleProfileWorkflow
  ↓
包装层创建 Workflow run 并执行 run.stream()
  ↓
Workflow step suspend
  ↓
包装层把 suspendPayload、resumeSchema 和嵌套 Workflow runId
提升为 Agent 的 tool-call-suspended
  ↓
应用调用 agent.resumeStream(resumeData, { runId: agentRunId })
  ↓
包装层定位原 Workflow run，调用 run.resumeStream()
  ↓
Workflow success
  ↓
结果作为原 workflow tool result 返回模型
  ↓
Agent 在同一个恢复流中继续推理
```

因此，本项目不需要再增加一个客户端工具来手工复制这层桥接，也不需要让浏览器同时维护 Agent `toolCallId` 与独立 Workflow `runId` 的关联。浏览器只需要知道当前挂起的 Agent run、对应 `toolCallId` 和结构化 `resumeData`；嵌套 Workflow 生命周期由 Mastra 管理。

### 5.3 Mastra Workflow 的标准入口

直接运行 Workflow 时，Mastra 提供独立的 `workflowRoute()` / `handleWorkflowStream()`：

```text
inputData  → run.stream()
resumeData → run.resumeStream()
```

这套协议适合明确由应用直接控制的 Workflow 页面、审批页面和后台流程，也就是 Workflow 本身就是应用入口的情况。

它与“Workflow 注册为 Agent 工具”是两种不同的拓扑：

| 拓扑 | 谁启动流程 | 完成后交还给谁 | 恢复入口 |
| --- | --- | --- | --- |
| Workflow 作为应用入口 | 页面、任务系统或后台服务 | 页面或业务服务 | `run.resumeStream()` / `handleWorkflowStream()` |
| Workflow 作为 Agent 工具 | Agent | 原 Agent 工具循环 | `agent.resumeStream()` / `handleChatStream()` |

当前风格画像由 Agent 判断何时调用，而且画像完成后 Agent 还要继续改写文章，因此属于第二种。不能仅仅为了绕开请求体复用问题，就把它改造成第一种并额外发明一个客户端门面工具；那会重复 Mastra 已经提供的 Workflow-as-Tool 生命周期管理。

### 5.4 Mastra 的 Tool suspension

Mastra 允许工具调用 `context.agent.suspend()`，并通过：

- `suspendSchema` 定义展示给用户的数据；
- `resumeSchema` 定义恢复数据；
- `tool-call-suspended` 事件通知 UI；
- `runId` 和 `toolCallId` 恢复准确的调用。

这是正式能力，适合：

- 外部 webhook；
- 审批按钮；
- 跨刷新或跨进程恢复；
- 需要持久化等待状态的长流程。

Mastra 还支持 `autoResumeSuspendedTools`：用户在同一 Memory thread 发送下一条自然语言消息时，Agent 根据 `resumeSchema` 提取恢复数据。这适合“你想查哪个城市？”之类自然语言补充；对于精确的多选文档 ID，它会重新引入 LLM 解析，不如结构化工具结果确定。

### 5.5 Memory 场景下的消息提交

默认 `DefaultChatTransport` 发送当前完整 `messages`，这是 AI SDK 通用 Chat 的合理默认值。

Mastra Memory 已经根据 `thread` / `resource` 召回历史时，前端只提交本次新增消息可以避免重复历史和顺序问题。使用 `DefaultChatTransport.prepareSendMessagesRequest` 裁剪请求，是官方提供的扩展点，不需要自行实现一套 Transport。

客户端工具续传时，最后一条新增消息通常是包含 tool output 的 assistant 消息，而不是最新 user 消息；这是正常的。服务端应由 Memory 补齐之前的用户上下文，不应额外发明一个随后又被删除的 `clientLatestUserText` 字段。

## 6. 这次故障的精确根因

### 6.1 触发链路

```text
① Agent 调用 buildStyleProfileWorkflow
  ↓
② Workflow 在 selectStyleReferences 中 suspend
  ↓
③ UI 展示材料选择器
  ↓
④ 用户确认，sendMessage(undefined, {
     body: { runId, resumeData }
   })
  ↓
⑤ handleChatStream 看到 resumeData，调用 agent.resumeStream()
  ↓
⑥ Workflow 分析完成，Agent 继续调用客户端写入工具
  ↓
⑦ 浏览器执行客户端工具并 addToolOutput()
  ↓
⑧ sendAutomaticallyWhen 判断工具结果完整，自动提交下一轮
  ↓
⑨ 自动提交沿用第④步请求的 body
  ↓
⑩ 相同 runId / resumeData 再次到达 handleChatStream
  ↓
⑪ Mastra 再次调用 agent.resumeStream()
  ↓
⑫ 快照已经被消费或运行已经完成
  ↓
⑬ AGENT_RESUME_NO_SNAPSHOT_FOUND
```

### 6.2 为什么 `addToolOutput(options)` 没有根治

故障发生时安装的 AI SDK `7.0.37` 存在一个对本问题非常关键的时序细节：

- 如果调用 `addToolOutput()` 时 Chat 已经空闲，它可以根据传入的 request options 发起后续请求；
- 如果调用时状态仍是 `streaming` 或 `submitted`，它只更新当前消息/活动响应，不会立即发请求；
- 当前流结束后，外层 `makeRequest()` 再检查 `sendAutomaticallyWhen`，并把本轮的 `metadata`、`headers` 和 `body` 原样传给下一次 `makeRequest()`。

其核心行为可以概括为：

```ts
if (await shouldSendAutomatically()) {
  await makeRequest({
    trigger: 'submit-message',
    metadata,
    headers,
    body,
  });
}
```

因此，客户端工具在恢复流仍在进行时同步返回结果，传给 `addToolOutput()` 的“客户端工具续传 body”并不会替换外层恢复请求的 body。后续自动请求仍可能携带旧的 `runId` / `resumeData`。

这个结论来自当前安装版本的源码，升级 AI SDK 后应重新检查，不能永久当成所有版本都不变的实现细节。

### 6.3 为什么服务端消息扫描也不是根治

`hasProgressedPastWorkflowSuspension()` 通过遍历 UI 消息判断：

```text
是否先看到了某个 runId 的 suspended 事件
且之后是否又出现了新的 part
```

它试图推断该快照是否已经被消费。但 UI transcript 不是事务日志：

- part 可能被裁剪；
- 页面刷新后本地消息可能不完整；
- transient data part 可能不持久化；
- 并行工具会改变 part 顺序；
- regenerate 和重连会重放消息；
- 服务端状态和浏览器消息到达顺序可能不一致。

因此，遍历消息只能兜底某些重复请求，不能可靠证明一个运行是否仍可恢复。可靠来源应该是明确的协议入口和 Mastra 持久化运行状态。

## 7. 各种现象应该如何理解

### 7.1 只输出“我先分析风格”，然后结束

这通常不是模型完全停止，而是当前 stream leg 在工具调用或挂起边界结束了。后续是否继续取决于：

- 服务端工具是否有 `execute`；
- 客户端工具是否被浏览器执行；
- 是否调用了 `addToolOutput`；
- 是否配置了正确的自动续传条件；
- 挂起运行是否收到一次有效的 resume。

### 7.2 `getDocumentSnapshot` 看起来没有返回值

如果工具定义没有 `execute`，它就是客户端工具声明。流里只出现：

```text
tool-input-start
tool-input-available
finish
```

是合理的：服务端在等待浏览器产生工具结果。只有浏览器调用 `addToolOutput()` 后，模型才能继续。

之前通过多个 `useEffect` 扫描所有消息执行工具，虽然可以工作，但等于项目自行实现客户端工具运行时，需要自行负责：

- 防止 React 重渲染导致重复执行；
- 区分 `input-streaming` 和 `input-available`；
- 确保一个 `toolCallId` 只执行一次；
- 写回成功和错误结果；
- 恢复刷新后的未完成调用；
- 决定什么时候重新提交消息。

改成官方 `onToolCall` + `addToolOutput` 是正确方向。

### 7.3 为什么会连续两次出现相同 `runId`

应按请求语义判断：

- 挂起事件带一个 `runId`，随后一次恢复请求携带同一个 `runId`：正常；
- 用户双击导致两个恢复请求：不正常，应做 UI 幂等；
- 第一次恢复后，客户端工具自动续传又携带同一个 `runId` / `resumeData`：本次故障；
- 网络只重连同一个响应流，但没有重新调用业务 `resumeStream()`：可能正常，不能只看 ID 下结论。

### 7.4 `finish` 不等于整个用户任务完成

`finish` 只说明当前 SSE/模型执行片段结束。下面几种情况都可能产生 `finish`：

- 模型已经给出最终回答；
- 模型产生客户端工具调用，等待浏览器结果；
- Agent/Workflow 已挂起，等待用户恢复；
- 当前一步完成，后续由另一次请求继续。

调试时必须同时查看最后的 message parts、tool state、suspension event 和下一次请求，而不能只看到 `[DONE]` 就认定整个业务结束。

### 7.5 `AGENT_RESUME_NO_SNAPSHOT_FOUND` 不一定是数据库坏了

该错误至少可能表示：

- `runId` 不属于当前 Agent；
- 运行从未挂起；
- 挂起快照没有持久化或已丢失；
- 运行已经成功恢复并完成；
- 同一个恢复命令被重复执行。

本次属于最后一种，而不是优先怀疑数据库或 Storage。

## 8. 为什么代码会越来越“魔法”

当前补丁大多不是孤立错误，而是同一架构冲突的连锁反应。

| 补丁 | 它试图解决的问题 | 为什么会继续扩张 |
| --- | --- | --- |
| 多个 `handled...Ref` | 防止扫描消息时重复执行客户端工具 | React 生命周期并不是工具运行时 |
| `requestKind` | 区分普通 Agent 请求、显式 Agent 恢复和客户端工具续传 | 显式意图本身可以合理，但当前实现还要结合消息扫描判断旧恢复 body 是否已消费，于是扩张成状态机 |
| `normalizeChatRequestBody` | 删除自动续传继承的恢复字段 | 需要猜测 body 的字段是当前值还是遗留值 |
| `hasProgressedPastWorkflowSuspension` | 防止再次恢复已完成 run | UI 消息被迫充当服务端运行状态数据库 |
| 自定义 `shouldAutomaticallyContinue` | 避免挂起状态被误判为工具完成 | AI SDK 工具状态和 Mastra suspension 状态被混在同一消息里 |
| 提示词禁止并行工具 | 降低触发竞态的概率 | 模型提示词不能保证传输协议正确性 |
| 把快照工具改成服务端 mock | 避免一次客户端工具往返 | 绕开了真实编辑器数据源，而不是解决工具边界 |

可以用以下信号判断是否正在重新实现框架：

- Route 需要遍历整段 UI 消息来决定调用哪个底层生命周期 API；
- Prompt 被用来保证网络请求顺序；
- React `useEffect` 扫描历史消息并执行工具；
- 一个临时请求命令被放进会被自动继承的公共 body；
- 每增加一种工具，就要同步修改多个防重集合；
- 必须使用 `as unknown as` 才能把两个流协议接在一起；
- 修复一个卡住问题后，又产生重复请求、消息裁剪或快照恢复问题。

## 9. 哪些做法是正确的

并不是现有实现全部错误。以下方向符合官方能力：

- 使用 `onToolCall` 执行自动客户端工具；
- 使用 `addToolOutput` 返回客户端执行结果；
- 使用 `DefaultChatTransport.prepareSendMessagesRequest` 做请求整形；
- Mastra Memory 场景只发送本次新增消息，而不是每轮重复发送全部历史；
- 显式区分 `clientTools` 和拥有 `execute` 的服务端工具；
- 把 Workflow 注册给 Agent，让它作为高层能力调用；
- 使用 Workflow `foreach` 控制多文档分析并发；
- 对按钮做一次简单的防双击/UI 幂等保护；
- 把单篇风格分析抽成领域函数，供 Tool 和 Workflow Step 复用。

问题集中在两点：

1. 一次合法的 Agent 恢复请求结束后，AI SDK 客户端工具自动续传沿用了该请求的一次性恢复 body；
2. 项目用 transcript 扫描、`requestKind` 和防重集合补偿这个时序问题，逐渐接管了本应由框架和清晰协议边界负责的生命周期。

Agent Chat 启动和恢复 Workflow-as-Tool 本身不是错误；Mastra 正式支持这条链路。错误发生在“已经完成恢复”之后，旧恢复命令又被当成普通客户端工具续传参数发送了一次。

## 10. 推荐目标架构

### 10.1 核心原则

> 当前业务由 Agent 发起，也要求 Workflow 完成后 Agent 继续完成改写，因此顶层运行所有者应保持为 Agent。

> Workflow 的人机交互仍由 Workflow 自己保证顺序；浏览器恢复的是包含该 Workflow 工具调用的 Agent run，不是另起一个独立 Workflow run。

> 一次 HTTP 请求只能表达一种继续意图：显式恢复 Agent，或提交客户端工具结果。`runId` / `resumeData` 是一次性恢复命令，不能泄漏到后续普通请求。

“浏览器渲染交互 UI”不等于“必须新增客户端工具”。UI 可以只是挂起运行的控制面。

### 10.2 风格画像链路

材料选择决定后续分析输入，是风格画像流程中的真实门禁。为了避免把“选择之后是否继续分析”重新交给模型决定，应保留 Workflow 内部的 `selectStyleReferences` suspension。

`buildStyleProfileWorkflow` 已经注册在 Agent 的 `workflows` 中。Mastra 自动把它暴露为高层服务端工具 `workflow-buildStyleProfileWorkflow`，所以 Agent 直接调用它即可：

```text
Agent
  ↓ 调用 Mastra 自动生成的 Workflow 工具
workflow-buildStyleProfileWorkflow({ inputData: { subject } })
  ↓
findStyleReferences
  ↓
selectStyleReferences → Workflow suspend
  ↓
Mastra 将 Workflow suspension 提升为 Agent tool-call-suspended
  ↓
浏览器展示材料选择器；此时没有新增客户端工具
  ↓ 用户确认
浏览器把 suspension 事件提供的 Agent runId 与结构化 resumeData
提交给 Agent Chat 恢复入口
  ↓
handleChatStream → agent.resumeStream(resumeData, { runId })
  ↓
Mastra Workflow-as-Tool 包装层恢复原 Workflow run
  ↓
校验选择 → 加载材料 → foreach 分析 → 汇总 → 持久化画像
  ↓
Workflow 工具返回 styleProfileId / StyleProfile
  ↓
Agent 在同一个恢复流中使用画像完成展示或改写
  ↓
需要时调用现有编辑器客户端工具
```

Workflow 保留：

- 检索候选材料；
- `selectStyleReferences` suspend step；
- `selectionSuspendSchema` 和 `selectionResumeSchema`；
- 从同一挂起步骤恢复并校验选择结果；
- 校验和加载选中文档；
- `foreach` 并发分析；
- 单篇失败重试；
- 汇总稳定风格特征；
- 产生进度事件；
- 持久化 StyleProfile（后续实现）。

Mastra Workflow-as-Tool 包装层负责：

- 创建并保存嵌套 Workflow run；
- 把 Workflow suspend payload 和当前 Step 的 `resumeSchema` 提升到 Agent suspension；
- 在 Agent 恢复时定位原 Workflow run 并调用 `run.resumeStream()`；
- Workflow 成功后把最终结果转换成原 Agent tool result。

浏览器只负责：

- 渲染 `tool-call-suspended` 中的材料候选和进度；
- 对用户确认按钮做 UI 防双击；
- 将选择结果作为结构化 `resumeData` 一次性提交给 Agent 恢复入口；
- 展示恢复流中的 Workflow 进度、最终回答和客户端编辑工具状态。

上传的附加材料应先保存为服务端可访问的文档 ID，再放入 Workflow `resumeData`；不要把完整正文长期塞进 tool output 或 Workflow snapshot。

这个设计的关键保证是：

```text
Workflow 尚未收到合法 selectedDocumentIds
  → selectStyleReferences 保持 suspended
  → load / analyze / synthesize 不可能开始

Workflow 恢复并完成材料分析
  → 原 workflow tool 才产生结果
  → Agent 才能继续风格改写
```

因此 Agent 没有机会在“已经选择、尚未分析”这个中间状态重新做一次不确定的模型决策，同时也没有多出一个需要浏览器维护生命周期的客户端门面工具。

### 10.3 材料选择 UI 为什么不是客户端工具

判断一段浏览器代码是不是 Agent 客户端工具，关键不在于“是否运行在浏览器”，而在于它是不是模型选择调用、并需要以 `toolCallId` / `addToolOutput()` 完成的能力。

材料选择器处理的是一个已经挂起的服务端运行：

```text
服务端已经执行到确定的 Workflow Step
  ↓
UI 展示 suspendPayload
  ↓
用户提交 resumeData
  ↓
恢复原 Agent run
```

这是应用控制面，不是新的模型工具调用。因此它：

- 不需要声明 `buildStyleProfileInteractively`；
- 不需要为选择动作调用 `addToolOutput()`；
- 不需要把 Agent `toolCallId` 映射到另起的 Workflow `runId`；
- 不会让 Agent 在选择和分析之间重新决策。

### 10.4 大纲确认链路

当前 `proposeArticleOutline` 通过 Agent tool suspension 等待用户编辑。这个 suspension 本身也是 Mastra 正式支持的能力，不需要再包装成 `createArticleInteractively` 客户端工具。

如果“确认大纲后必须继续生成全文”只是一个较短的 Agent 流程，可以保持：

```text
Agent 调用 proposeArticleOutline
  ↓
服务端 Tool suspend
  ↓
浏览器编辑并确认大纲
  ↓
恢复 Agent run
  ↓
Agent 根据确认后的 outline 继续生成全文
```

如果该过程逐渐出现多个确定步骤、跨刷新恢复、重试和进度要求，则把它升级为 Workflow-as-Tool：

```text
Agent 调用 createArticleWorkflow
  ↓ outline
Workflow 生成大纲 → suspend → 用户编辑 → Agent resume
  ↓
Workflow 继续生成与校验全文 → 返回 Agent
```

两种模式都恢复 Agent run；区别只是确定性步骤由普通 Agent tool 还是 Workflow-as-Tool 承载。不要为了显示大纲编辑器而新建客户端门面工具。

如果用户取消，应通过 Tool/Workflow 的 `resumeData` 分支返回明确业务结果或 `bail()`：

```ts
{ status: 'cancelled' }
```

取消不是传输错误，不应伪装成客户端工具 `output-error`。

### 10.5 文档读写工具

`getDocumentSnapshot` 放在客户端还是服务端，取决于文档的唯一事实来源，而不是取决于哪种方式更容易绕过续传。

#### 服务端为事实来源

```text
数据库/服务端文档 = canonical state
编辑器 = 展示与编辑副本
```

此时 `getDocumentSnapshot` 应是服务端 Tool，编辑器修改需要可靠同步到服务端。

#### 浏览器编辑器为事实来源

```text
Plate 编辑器 = canonical state
服务端没有实时正文
```

此时 `getDocumentSnapshot` 就应该是客户端 Tool，并通过标准 `onToolCall` / `addToolOutput` 返回快照。它和 `writeMarkdownToPlate`、`applyLocalEdit` 一样，不需要被禁止。

当前服务端 mock 只能用于短期联调，不应成为正式架构。

### 10.6 客户端编辑工具的续传策略

当前客户端工具包括 `getDocumentSnapshot`、`writeMarkdownToPlate` 和 `applyLocalEdit`。它们是否需要触发下一次模型请求，应按业务语义决定，而不是全局无条件启用自动续传：

| 类型 | 示例 | `addToolOutput()` | 是否立即再次请求模型 |
| --- | --- | --- | --- |
| 终端 UI 动作 | 写入已完成正文、执行最终局部替换 | 必须记录成功或错误 | 通常不需要；但必须保证工具结果按消息持久化策略保存 |
| 非终端客户端能力 | 返回模型后还要继续判断、调用其他工具 | 必须记录成功或错误 | 需要一个新的普通 Agent 请求 |

如果客户端工具是在 Agent 恢复流中产生，而它的结果还要提交给模型，下一次请求必须满足：

```text
has runId      = false
has resumeData = false
intent         = client-tool-result / normal agent continuation
```

当前 AI SDK 版本会在 stream 结束后的自动续传中复用父请求 body，所以不能假定给 `addToolOutput(options)` 传一个新 body 就一定覆盖恢复 body。应先在受支持的 AI SDK / Mastra Adapter 版本组合上做最小复现；如果仍需适配，只在 Transport 边界实现“一次性恢复命令不继承”，不要扫描 UI transcript，也不要新增业务客户端工具掩盖协议问题。

### 10.7 目标请求链路

```text
普通用户消息 → /api/chat → agent.stream
  ↓
Agent 调用 workflow-buildStyleProfileWorkflow
  ↓
Workflow 内部 suspend，Mastra 输出 Agent tool-call-suspended
  ↓
用户确认 → /api/chat（显式 Agent runId + resumeData）
  ↓
handleChatStream → agent.resumeStream
  ↓
Mastra 恢复原 Workflow → Workflow 返回结果 → Agent 继续
  ↓
Agent 调用 writeMarkdownToPlate / applyLocalEdit
  ↓
浏览器 addToolOutput
  ↓
若工具为终端动作：结束本轮，不自动请求模型
若模型必须继续：发起不带旧 runId/resumeData 的普通 Agent 请求
```

Chat endpoint 可以正式支持两种 Mastra Agent 调用，但每个请求只能选择其中一种：

```text
无 resumeData → agent.stream
有 resumeData + 有效 runId → agent.resumeStream
```

它不应再需要理解：

- “是否已经越过 Workflow 挂起点”；
- 哪些消息 part 表示快照已消费；
- 某个恢复 body 是否需要清洗。

如果前端 Transport 无法保证恢复字段只发送一次，可以保留一个很窄的请求意图标识或专用 Agent-resume 调用，但它必须建立在显式操作上，而不是从消息顺序反推。是否需要这层适配，应在版本对齐和最小复现后决定。

### 10.8 什么时候才使用独立 Workflow endpoint

只有当 Workflow 本身是顶层应用流程时，才优先使用 `handleWorkflowStream()`：

- 独立审批中心；
- 后台批处理或任务页面；
- 不需要回到原 Agent 工具循环；
- 由业务系统而不是模型决定何时启动。

如果未来真的选择“客户端门面 + 独立 Workflow”方案，它应被明确记录为框架集成的备用适配，并承担关联持久化、刷新恢复和错误同步成本；不能把它描述成 Mastra Workflow-as-Tool 的默认用法。

## 11. 什么时候仍然应该使用 suspend/resume

不能因为这次冲突就否定 Mastra suspension。是否使用它不只取决于等待时间长短，更取决于用户输入是不是确定性流程中的门禁。

适合使用的情况包括：

- 用户选择直接决定后续 Workflow 的合法输入；
- 要保证收到选择后从固定 Step 继续，而不是重新交给 Agent 决策；
- 审批可能几小时或几天后到达；
- 页面刷新后还要恢复；
- 审批来自 webhook、消息队列或另一位用户；
- 运行必须准确恢复到某个 Workflow Step；
- 需要审计谁在何时批准了什么。

本项目的风格参考材料选择符合前两条，因此保留 Workflow `suspend/resume` 是合理的。问题不在 suspension，也不在 Agent 恢复入口本身，而在一次性恢复命令被后续客户端工具自动请求再次继承。

当 Workflow 作为 Agent 工具运行时，应采用 Agent suspension 协议：

```text
Agent 调用 Workflow-as-Tool
  ↓
Workflow suspend，挂起状态传播到 Agent
  ↓
浏览器渲染 suspendPayload
  ↓
用户提交结构化 resumeData
  ↓
handleChatStream → agent.resumeStream({ runId, resumeData })
  ↓
Mastra 恢复原 Workflow Step
  ↓
Workflow 完成并把结果返回 Agent
```

只有独立 Workflow 页面才直接使用 `handleWorkflowStream()`。当前场景不要改变顶层运行所有者；真正需要避免的是恢复 Agent 的 HTTP 请求结束后，客户端工具自动续传再次携带同一份恢复命令。

## 12. 方案比较

| 方案 | 代码复杂度 | 恢复持久性 | 结构化结果确定性 | 适用场景 | 建议 |
| --- | --- | --- | --- | --- | --- |
| Agent 收到选择结果后，再由模型决定是否调用分析 Workflow | 低 | 依赖 Chat 消息 | 低 | 可容忍模型改变流程 | 不用于当前风格分析 |
| Agent 直接调用 Workflow-as-Tool + 显式恢复 Agent run | 低到中 | 高，依赖 Mastra Storage | 高 | 当前材料选择、分析后继续改写 | **首选** |
| `autoResumeSuspendedTools` | 低 | 依赖 Memory/Storage | 中 | 用户自然语言补充信息 | 不用于精确多选 ID |
| 独立 Workflow endpoint，Workflow 是应用入口 | 中 | 高 | 高 | 审批中心、后台任务、独立流程页 | 在该拓扑中推荐 |
| 高层客户端门面 + 独立 Workflow route | 高 | 高，但需额外关联状态 | 高 | 直接 Agent 恢复在已验证兼容组合中仍不可用 | 备用适配，不是默认设计 |
| 单个服务端 Tool 内完成全部分析 | 最低 | 低 | 高 | 无需进度、并发、可观察性的简单任务 | 简单场景可用 |
| Agent resume 后让客户端工具自动续传继承旧恢复 body | 高且持续增长 | 表面有、实际脆弱 | 低 | 无 | 淘汰 |

## 13. `buildStyleProfileWorkflow` 是否还有必要

有必要保留，但理由不是“Workflow 比 Tool 更高级”，而是当前任务确实具备 Workflow 特征：

- 明确的多步骤数据流；
- 动态数量文档的 fan-out/fan-in；
- 并发度控制；
- 单篇重试和局部失败容忍；
- 汇总步骤；
- 进度可观察性；
- 未来可能持久化画像。

如果以后这个能力退化成“一次模型调用分析一篇已经确定的文档”，普通服务端 Tool 会更合适。

因此应做的不是把整个 Workflow 改成 Tool，而是：

> 保留“检索 → 选择并挂起 → 恢复 → 分析 → 汇总”的完整 Workflow，并继续通过 Agent 的 `workflows` 配置把它作为高层能力暴露。Mastra 已负责 Workflow-as-Tool 的启动、挂起传播和恢复；应用只需要恢复 Agent run，不应再套一层客户端门面。

## 14. 不应再依赖提示词保证串行

“禁止客户端工具和服务端工具并行调用”只能影响模型倾向，不能成为并发和一致性保障：

- 模型仍可能输出多个 tool call；
- 换模型或升级模型后行为可能改变；
- 简单修改也可能被错误阻止读取文档；
- Prompt 无法阻止浏览器重复提交 HTTP 请求；
- Prompt 无法保证 `runId` 只消费一次。

真正需要顺序时，应建立真实数据依赖：

```text
Workflow 尚未收到 selectedDocumentIds
  → selectStyleReferences 仍保持 suspended
  → load / analyze / synthesize 不可能开始

Workflow 尚未完成并产生 styleProfileId
  → workflow-buildStyleProfileWorkflow 不产生最终 tool result
  → Agent 不会进入风格改写阶段

没有最新 snapshot
  → applyLocalEdit 无法得到 expectedText

没有用户确认后的 outline
  → 全文生成步骤没有合法输入
```

必要时还可以在应用编排层按阶段限制可用工具，但不要全局隐藏 `getDocumentSnapshot` 之类常用能力来修复单一场景。

## 15. 版本兼容性风险

故障调查时，`@mastra/ai-sdk@1.6.3` 的公开类型只声明：

```ts
version?: 'v5' | 'v6'
```

默认是 `v5`。当时项目使用 AI SDK 7 的 `createUIMessageStreamResponse`，并通过：

```ts
stream as unknown as Parameters<
  typeof createUIMessageStreamResponse
>[0]['stream']
```

绕过了类型不匹配。

这不能直接证明运行时一定不兼容，但可以确定：

> 当前组合不在 Adapter 公开声明的流协议合同内，类型系统已经无法替我们检查消息 part 和恢复事件是否一致。

另外，当前 Adapter 的 v6 分支可以从 AI SDK 原生 `approval-responded` part 中恢复布尔审批，生成的恢复数据主要是 `approved` 和可选 `reason`。这适合批准/拒绝，不等价于任意结构化的材料多选结果。

改造前应先做版本决策：

1. 选择 Mastra Adapter 明确支持的 AI SDK UI 版本，并显式传入对应 `version`；或
2. 升级到明确声明支持 AI SDK 7 的 Adapter 版本；
3. 删除双重类型断言，让编译器重新检查完整流协议。

当前已经按 Adapter README 的公开合同切换到 AI SDK 6，并显式传入 `version: 'v6'`。DeepSeek provider 使用与 AI SDK 6 Provider V3 合同匹配的 `@ai-sdk/deepseek@2`，而不是依赖 Provider V4 的 v3。

## 16. 建议删除或收缩的代码

完成目标架构后，应删除：

- 文档或代码中拟议的 `buildStyleProfileInteractively` 客户端工具；
- 任何 `agentToolCallId ↔ workflowRunId` 浏览器关联状态；
- `hasProgressedPastWorkflowSuspension()`；
- Chat route 中判断 `shouldResumeWorkflow` 的消息扫描；
- Agent 消息中用于推断 Workflow 是否已经恢复的状态扫描和防重集合；
- 提示词中的客户端/服务端/Workflow 全局互斥规则；
- 当前发送后又在 Route 删除的 `clientLatestUserText`；
- 为协议兼容而添加的 `as unknown as` 流类型断言。

以下内容不能在没有验证前一并删除：

- 风格选择和大纲确认向 Agent 恢复入口提交一次 `runId` / `resumeData`：这是正式 suspension 恢复，不是补丁；
- `sendAutomaticallyWhen`：是否保留取决于现有客户端编辑工具是否需要模型继续；
- `src/lib/chat-request.ts`、`CHAT_REQUEST_KINDS`、`normalizeChatRequestBody()`：先在兼容版本上验证。如果官方链路能保证恢复 body 不继承，应删除；如果仍需区分显式 Agent 恢复，只保留一个窄的、由用户操作直接设置的一次性意图，不得扫描 transcript 推断；
- `clientToolContinuationOptions`：只有确实存在非终端客户端工具且能保证发起全新普通请求时才保留。

可以保留并收缩：

- `DefaultChatTransport.prepareSendMessagesRequest`：只负责注入 Mastra Memory 的 thread/resource 标识，其余请求保持 AI SDK 默认的完整消息提交方式；
- 客户端按钮防双击：只负责 UI 幂等，不负责推断服务端运行状态；
- `onToolCall`：只处理自动执行的客户端工具；
- `selectStyleReferences`、`selectionSuspendSchema` 和 `selectionResumeSchema`：继续作为 Workflow HITL 边界；
- `tool-call-suspended` 渲染：展示选择器并恢复 Agent run，不启动独立 Workflow；
- `handleChatStream()`：继续作为普通 Agent stream 和显式 Agent resume 的统一适配入口；
- `addToolOutput()`：所有客户端工具都必须返回成功或错误结果；
- 官方 `lastAssistantMessageIsCompleteWithToolCalls`：仅在客户端工具确实需要下一次模型推理时使用。

## 17. 推荐迁移顺序

### 阶段 0：明确三个架构决策

在改代码前确定：

1. AI SDK 与 Mastra Adapter 的目标兼容版本；
2. 当前文档的事实来源是服务端还是浏览器编辑器；
3. `writeMarkdownToPlate`、`applyLocalEdit` 分别是终端 UI 动作，还是模型必须读取结果后继续推理的非终端客户端工具。

第三项直接决定是否需要客户端工具自动续传，不能用一个全局 helper 替所有工具作答。

### 阶段 1：验证 Mastra 原生 Workflow-as-Tool 恢复

- 保持 `buildStyleProfileWorkflow` 注册在 Agent 的 `workflows` 中；
- 用当前目标兼容版本建立最小测试：Agent 调用 Workflow、Workflow suspend、显式 `agent.resumeStream()`、Workflow success、Agent 收到 tool result；
- 测试中先不加入客户端编辑工具，确认 Mastra 原生桥接本身成立；
- 核对 suspension 事件提供的 Agent `runId`、`toolCallId`、`resumeSchema` 和恢复后的 Workflow 结果；
- 不新增客户端门面或独立 Workflow endpoint。

### 阶段 2：保留并完善 Workflow HITL

- 保留 `findStyleReferences → selectStyleReferences(suspend) → load → foreach analyze → synthesize`；
- 继续使用 `selectionSuspendSchema` / `selectionResumeSchema` 校验 UI 与 Workflow 的协议；
- 对不存在或无权限的 ID 在服务端重新校验；
- 为用户取消定义明确的 `resumeData` 分支，并在 Workflow 中使用 `bail()` 或等价终态结束；
- Workflow 成功后持久化 StyleProfile，并优先返回 `styleProfileId`，避免把大段画像反复放入 Chat 消息。

### 阶段 3：让前端只承担 Agent suspension 控制面

- 保留 `StyleReferenceSelection` 对 `tool-call-suspended` 的渲染；
- 用户确认后只向 Agent 恢复入口提交事件提供的 `runId` 和结构化 `resumeData`；
- 选择动作不调用 `addToolOutput()`，因为它不是新的客户端工具；
- 按钮防双击只防止重复用户操作，不判断服务端快照状态；
- 页面刷新恢复需求使用 Mastra suspended-run / Storage 能力设计，不通过扫描当前 React 消息猜测。

### 阶段 4：隔离恢复请求与客户端工具续传

当前先不执行本阶段的自定义隔离，保持 AI SDK 6 官方 `sendAutomaticallyWhen` 行为，以便确认问题在受支持版本组合中是否仍然存在。只有获得新的可复现请求证据后，才重新评估是否需要最小适配。

- 先分别测试“恢复后只输出文本”和“恢复后产生客户端编辑工具”两条链路；
- 终端客户端工具调用 `addToolOutput()` 后不自动请求模型，同时验证工具结果的消息持久化；
- 非终端客户端工具需要继续时，确保下一请求是全新的普通 Agent 请求，不含旧 `runId` / `resumeData`；
- 删除 `hasProgressedPastWorkflowSuspension()` 和 Route 的 UI part 扫描；
- 如果版本匹配后不再需要请求意图区分，删除 `requestKind`；如果仍需要，只保留最小、显式、一次性的 Agent-resume 意图；
- 让 `handleChatStream` Route 回到“无恢复数据则 stream，有恢复数据则 resume”的薄适配层。

### 阶段 5：恢复真实文档数据源

- 服务端为事实来源：实现真实文档存储和编辑同步；
- 浏览器为事实来源：把 `getDocumentSnapshot` 恢复为标准客户端工具；
- 删除 mock 正文。

### 阶段 6：补齐协议测试

先测试协议，再测试模型文案。至少覆盖：

1. 一个服务端工具后直接回答；
2. Agent 调用 Workflow-as-Tool 后正常查找候选并 suspend；
3. 用户选择精确恢复 Agent run，而不是创建新的 Workflow run；
4. Agent 恢复后 Mastra 自动继续原 Workflow；
5. Workflow 恢复后一定执行加载、分析和汇总；
6. Workflow 成功后结果作为原 workflow tool result 返回 Agent；
7. Agent 收到画像结果后继续获取快照和生成改写；
8. 恢复流产生终端编辑器客户端工具时，不重复恢复同一快照；
9. 非终端客户端工具需要续传时，下一请求不含旧 `runId` / `resumeData`；
10. 所有客户端工具成功和失败路径都有对应 tool output；
11. 用户取消 Workflow；
12. Workflow 分析失败；
13. 用户双击确认不会重复消费同一 Agent snapshot；
14. 页面刷新后可通过 Storage 发现挂起 run，或按产品要求明确降级；
15. regenerate 场景下新增消息裁剪；
16. 普通 Agent 请求不携带恢复命令；
17. 显式 Agent resume 请求只消费一次；
18. 不存在 `buildStyleProfileInteractively` 或浏览器 `agentToolCallId ↔ workflowRunId` 状态机；
19. Workflow 作为独立应用入口的单独测试，不与 Agent 工具链路混用。

## 18. 建议建立的协议不变量

这些规则应写进测试或服务端校验，而不是只写进 Prompt：

1. 每个客户端 `toolCallId` 最终只有一个成功或错误结果；
2. `runId` / `resumeData` 是一次性命令，不是会话元数据；
3. 当前拓扑中，材料选择恢复的是 Agent run，不直接调用独立 Workflow endpoint；
4. 嵌套 Workflow run 的创建、挂起传播和恢复由 Mastra Workflow-as-Tool 包装层负责；
5. 浏览器不创建 `buildStyleProfileInteractively`，也不维护 `agentToolCallId ↔ workflowRunId`；
6. 普通 `/api/chat` 客户端工具续传不携带 Mastra 恢复命令；
7. 恢复接口只能恢复当前仍处于 suspended 状态的 Agent run；
8. 同一恢复命令需要幂等保护；
9. UI transcript 不用于推断服务端快照是否存在；
10. `sendAutomaticallyWhen` 是否再次请求由客户端工具语义决定，不能默认覆盖所有工具；
11. Prompt 不承担网络协议和并发正确性；
12. 工具和 Workflow schema 表达真正的前置依赖；
13. 编辑器文档只有一个明确的 canonical source；
14. 前后端 UIMessage/stream 版本必须处于公开兼容合同内；
15. 类型断言不能跨越协议版本边界；
16. 每一次自动发起的新请求都能从日志中看出触发原因和是否携带一次性恢复命令；
17. 独立 Workflow endpoint 只用于 Workflow 作为顶层应用入口的流程，不与同一次 Agent 工具调用混用。

## 19. 可观察性建议

调试此类问题时，建议为每次请求记录以下结构化字段：

```ts
{
  requestId,
  protocol: 'agent-chat' | 'agent-resume' | 'client-tool-result' | 'standalone-workflow',
  chatId,
  threadId,
  trigger,
  latestMessageId,
  latestMessageRole,
  toolCallIds,
  hasRunId,
  hasResumeData,
  agentRunId,
  nestedWorkflowRunId, // 来自服务端 trace，不由浏览器维护映射
  workflowStep,
  responseFinishReason,
}
```

不要默认记录：

- 完整系统提示词；
- 完整公文正文；
- 用户上传文件正文；
- 未脱敏的 Workflow snapshot。

对每个自动请求至少能回答：

```text
是谁触发的？
为什么触发？
它是正常 Chat、Agent 挂起恢复、工具结果续传，还是独立 Workflow？
它消费了哪个 toolCallId 或 runId？
如果是客户端工具结果请求，为什么还携带了恢复字段？
```

建议在开发环境使用 AI SDK DevTools、Mastra Studio/Trace 和浏览器 Network 三方交叉定位，而不是只看其中一层。

## 20. 故障排查清单

遇到“Agent 调完工具就卡住”时，按以下顺序检查：

### 工具定义

- 工具有没有 `execute`？
- 如果没有，它是否被当作客户端工具传给前端？
- 客户端是否对这个 `toolName` 调用了 `addToolOutput`？
- 错误路径是否也返回了 `output-error`？

### 消息状态

- 最后一个 part 是 `input-streaming`、`input-available` 还是 `output-available`？
- 是否有 `tool-call-suspended`？
- `finish` 表示最终结束还是等待下一请求？
- `sendAutomaticallyWhen` 对最后一个 step 的判断是什么？

### 请求

- 自动续传的 body 是否带入了上一轮临时字段？
- 是否意外提交了全部历史并造成重复？
- `trigger` 是 `submit-message` 还是 `regenerate-message`？
- 是否有两个请求消费同一个恢复命令？

### Mastra 运行

- `runId` 是否属于正确 Agent/Workflow？
- 当前运行是否仍是 suspended？
- Storage 是否持久化了 snapshot？
- 是 `agent.stream()` 还是 `agent.resumeStream()` 被调用？

### 版本

- 当前包版本自带文档支持哪个 UIMessage 版本？
- 前端和后端使用的是不是同一流协议？
- 是否存在掩盖类型错误的 `unknown`/`any` 双重断言？

## 21. 从这次事故得到的设计经验

### 21.1 一次性命令不能放进会自动继承的公共上下文

`runId` / `resumeData` 表达“现在执行一次恢复”，不是“以后每个请求都携带的会话属性”。这类字段必须是一次性、可消费、可幂等验证的命令。

### 21.2 不要通过 transcript 反推服务端生命周期

消息历史适合展示和模型上下文，不适合证明快照是否存在、事务是否提交或恢复是否已消费。服务端状态应由明确状态存储或独立协议决定。

### 21.3 交互展示位置与流程所有权是两件事

材料多选、大纲编辑和确认弹窗都应该由浏览器渲染，但这不意味着后续流程必须交回 Agent 决策。如果用户输入是 Workflow 的门禁，UI 负责展示，Workflow 仍应负责 suspend、校验和恢复后的确定性步骤。

### 21.4 suspend 是产品语义，不是 UI 渲染技巧

使用 suspend 意味着应用接受了快照、恢复命令、幂等、失效、权限和审计等一整套生命周期责任。仅仅为了显示一个选择器不值得引入这些成本；但当选择结果决定后续 Workflow 的合法输入，而且要求恢复后一定继续分析时，它就是合理的流程门禁。本项目的风格材料选择属于后一种情况。

### 21.5 Workflow 的价值在确定性流水线

Workflow 应承载步骤、门禁、并发、重试、状态和可观察性。与流程无关的 UI 状态不应塞进 Workflow，但直接决定后续步骤输入的人机决策可以属于 Workflow。

### 21.6 Prompt 不能替代编排

Prompt 可以描述业务策略，不能保证 exactly-once、调用顺序、请求幂等和协议隔离。需要硬保障的规则必须落在 schema、状态机、路由或存储层。

### 21.7 类型断言是架构报警器

跨 SDK 的流类型需要双重断言时，应先检查协议版本，而不是立即消除错误。类型系统很可能正在提示一个真实的运行时边界。

### 21.8 优先使用框架扩展点，不接管框架运行时

合理扩展包括：

- `onToolCall`；
- `addToolOutput`；
- `sendAutomaticallyWhen`；
- `prepareSendMessagesRequest`；
- Mastra Tool/Workflow schema；
- `handleChatStream` 用于 Agent stream/resume；
- `handleWorkflowStream` 用于 Workflow 作为独立应用入口。

高风险做法包括：

- `useEffect` 扫描全部消息执行工具；
- Route 扫描 UI parts 推断是否可以恢复；
- 自己维护工具调用状态和跨请求生命周期；
- 用 Prompt 避免触发框架边界问题。

### 21.9 对 Agent 暴露高层能力，不暴露流程中间态

Agent 适合决定“是否需要建立风格画像”和“画像完成后如何使用”，不适合决定“用户已经选择材料后是否还要执行原定分析”。后者应由 Workflow 保证。注册在 `workflows` 中的 `buildStyleProfileWorkflow` 已经是 Agent 看到的高层工具，不需要再套一层客户端工具。

### 21.10 浏览器交互不自动等于客户端工具

客户端工具是模型调用的能力；挂起 UI 是应用对已有运行状态的控制面。材料选择器虽然运行在浏览器，但它提交的是 Workflow Step 的 `resumeData`，不是一个新的模型 tool output。把所有浏览器行为都建模成客户端工具，会制造不必要的工具层级和跨运行关联状态。

### 21.11 不要用改变流程所有者来修复 Transport 问题

请求体继承发生在 AI SDK / Mastra Adapter 边界。把 Agent 发起的 Workflow 改成浏览器发起的独立 Workflow，虽然能绕开当前症状，却改变了顶层运行所有者，并要求应用重新实现 Workflow 完成后如何回到 Agent。应先修复或隔离一次性请求参数；只有产品本来就需要独立 Workflow 页面时，才改变拓扑。

## 22. 最终决策建议

针对当前项目，建议采用以下决策：

```text
保留：
  buildStyleProfileWorkflow 的检索、选择、suspend/resume、加载、并发分析、汇总能力
  selectionSuspendSchema / selectionResumeSchema
  documentAgent.workflows 中的 buildStyleProfileWorkflow 注册
  Mastra Workflow-as-Tool 原生挂起传播与 Agent resume
  Mastra Memory
  DefaultChatTransport 的轻量请求整形
  浏览器对 tool-call-suspended 的材料选择 UI

明确：
  Agent 决定何时调用 Workflow 以及如何使用最终画像
  Workflow 保证“查找 → 选择 → 恢复 → 分析 → 汇总”
  浏览器只渲染选择 UI 并恢复 Agent run
  终端与非终端客户端编辑工具采用不同续传策略

隔离：
  显式 Agent resume 请求中的一次性 runId / resumeData
  后续普通 Agent / 客户端工具结果请求
  独立 Workflow 页面与 Agent Workflow-as-Tool 两种拓扑

不新增：
  buildStyleProfileInteractively 客户端门面
  独立的 buildStyleProfileWorkflow endpoint（当前 Agent 场景）
  agentToolCallId ↔ workflowRunId 浏览器状态机

删除：
  消息扫描式恢复判断
  通过 transcript 判断快照是否已消费的补丁
  提示词串行协议
  跨版本流类型断言

验证后决定：
  requestKind 是否可以完全删除，还是收缩为一个显式、一次性的 Agent-resume 意图
  sendAutomaticallyWhen 是否只用于确实需要模型继续的客户端工具
```

一句话概括：

> 不要把用户选择移出 Workflow，也不要再增加客户端门面来驱动独立 Workflow；让 Agent 直接调用 Mastra 的 Workflow-as-Tool，浏览器只恢复 Agent run，并确保后续客户端工具请求不继承已经消费的 `runId` / `resumeData`。

## 23. 官方资料与版本匹配依据

公开文档：

- [AI SDK：Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- [AI SDK：useChat API](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [AI SDK：Stale body values with useChat](https://ai-sdk.dev/docs/troubleshooting/use-chat-stale-body-data)
- [AI SDK：Tool Invocation Missing Result](https://ai-sdk.dev/docs/troubleshooting/tool-invocation-missing-result)
- [AI SDK：WorkflowChatTransport](https://ai-sdk.dev/docs/reference/ai-sdk-workflow/workflow-chat-transport)
- [Mastra：AI SDK UI 集成指南](https://mastra.ai/guides/build-your-ui/ai-sdk-ui)
- [Mastra：handleChatStream](https://mastra.ai/reference/ai-sdk/handle-chat-stream)
- [Mastra：handleWorkflowStream](https://mastra.ai/reference/ai-sdk/handle-workflow-stream)
- [Mastra：Agents Using Tools](https://mastra.ai/docs/agents/using-tools)
- [Mastra：Workflow Human-in-the-loop](https://mastra.ai/docs/workflows/human-in-the-loop)
- [Mastra：Agent Approval 与 Tool Suspension](https://mastra.ai/docs/agents/agent-approval)
- [Mastra：Human-in-the-Loop 应放在 Agent 还是 Workflow](https://mastra.ai/blog/hitl-where-to-put-approval-in-agents-and-workflows)
- [Mastra UI Dojo：Workflow suspend/resume 示例](https://github.com/mastra-ai/ui-dojo/blob/main/src/pages/ai-sdk/workflow-suspend-resume.tsx)

本项目当前安装版本的本地依据：

- `node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx`
- `node_modules/ai/docs/09-troubleshooting/17-use-chat-stale-body-data.mdx`
- `node_modules/ai/docs/07-reference/04-ai-sdk-workflow/02-workflow-chat-transport.mdx`
- `node_modules/ai/src/ui/chat.ts`
- `node_modules/ai/src/ui/last-assistant-message-is-complete-with-tool-calls.ts`
- `node_modules/@mastra/ai-sdk/dist/chat-route.d.ts`
- `node_modules/@mastra/ai-sdk/dist/workflow-route.d.ts`
- `node_modules/@mastra/ai-sdk/dist/index.js`
- `node_modules/@mastra/core/dist/docs/references/docs-agents-using-tools.md`
- `node_modules/@mastra/core/dist/docs/references/docs-agents-agent-approval.md`
- `node_modules/@mastra/core/dist/docs/references/docs-workflows-human-in-the-loop.md`
- `node_modules/@mastra/core/dist/chunk-YU5XS4H4.js` 中 `listWorkflowTools()` 的 Workflow-as-Tool 启动、挂起传播和恢复实现
- `node_modules/@mastra/core/dist/docs/references/reference-ai-sdk-chat-route.md`
- `node_modules/@mastra/core/dist/docs/references/reference-ai-sdk-workflow-route.md`

升级依赖后，应优先重新阅读新版本 `node_modules` 中的文档和源码，再决定本文哪些实现细节仍然成立。
