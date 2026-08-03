# 文件上传与 AI 文件引用设计实践

本文记录本项目从零实现文件上传、预览、下载、消息引用和 AI 阅读文件的完整过程。

文档的目标不是只描述当前代码，而是总结一套以后可以复用的思路：

```text
文件如何存储？
文件如何展示？
消息中保存什么？
模型真正接收什么？
不同模型不支持文件时如何兼容？
```

---

## 一、需求背景

本项目需要同时支持两种文件操作：

1. **导入到编辑器**：上传文件后解析并写入编辑器，改变当前文档内容。
2. **上传到对话**：上传文件后显示在输入框上方，可以预览，也可以作为当前消息的附件交给 AI 阅读。

这两种能力虽然都包含“上传文件”，但语义完全不同：

| 能力 | 目的 | 是否进入编辑器 | 是否作为消息附件 |
| --- | --- | --- | --- |
| 导入到编辑器 | 修改当前编辑内容 | 是 | 否 |
| 上传到对话 | 给 Agent 提供参考资料 | 否 | 是 |

因此不能复用同一个前端状态或同一套提交逻辑。对话上传的文件必须先保留在输入框中，等用户输入问题后一起发送。

---

## 二、总体设计原则

这次实现中最重要的原则是：

> 文件的“业务引用”与文件的“模型内容”分离保存。

也可以理解为三个层次：

```text
UI 层：保存和展示文件引用
    ↓
消息层：保存标准 file part
    ↓
模型层：根据目标模型能力，把文件转换成模型能够理解的内容
```

### 1. UI 层不负责展开文件内容

前端只需要保存：

```json
{
  "id": "文件 ID",
  "originalName": "demo.md",
  "mimeType": "text/markdown",
  "size": 1024,
  "viewUrl": "/api/files/文件 ID"
}
```

前端可以用这些信息显示文件卡片、预览按钮和下载链接，但不需要把文件正文读出来再塞进消息。

### 2. 历史消息保存标准文件引用

发送消息时使用 AI SDK 的标准写法：

```ts
await sendMessage({
  text: "请总结这个文件。",
  files: [
    {
      type: "file",
      url: "/api/files/file-id",
      mediaType: "text/markdown",
      filename: "demo.md",
    },
  ],
})
```

这类数据适合保存到 UI Message 或历史记录中，因为它仍然代表“用户上传了哪个文件”。

### 3. 模型层不能直接依赖本地 URL

`/api/files/file-id` 只对当前 Web 应用有意义。DeepSeek 等远程模型不能访问本地开发服务器，也不会自动调用我们的文件接口。

因此必须在服务端完成：

```text
文件 ID
    ↓
Workspace 读取文件
    ↓
得到正文
    ↓
根据模型能力转换
    ↓
发送给 LLM
```

---

## 三、文件存储方案

当前使用 MinIO（S3 兼容对象存储），object key 为：

```text
{fileId}/content.md
{fileId}/metadata.json
```

文件内容与文件元数据分开保存。

早期版本用的是 Mastra Workspace 的 `LocalFilesystem`，落在 `.data/uploads/` 下。因为这套 key 约定本身就是扁平的，迁移到对象存储时路径逻辑一行没改 —— 只把读写实现换掉了。

需要注意的是，当时引入的 `Workspace` 实际上从未接进 Agent（没有作为工作区能力暴露给工具），它只是被 processor 当作文件读取器使用，所以移除它不损失任何能力。

### 文件内容

文件内容保留原始字节，避免上传时因为错误的字符编码转换而损坏内容。

### 文件元数据

示例：

```json
{
  "id": "8b823777-c5c9-4bdd-896b-6dcdec0c7001",
  "originalName": "demo.md",
  "mimeType": "text/markdown",
  "size": 1024,
  "extension": ".md",
  "contentPath": "8b823777-c5c9-4bdd-896b-6dcdec0c7001/content.md",
  "createdAt": "2026-07-30T14:14:28.147Z"
}
```

元数据的作用不是替代消息中的 `file` part，而是让服务端能够根据文件 ID 找到真实文件，并提供名称、大小、类型和创建时间等信息。

### 读写权限分离

对象存储没有 `readOnly` 标志，改成导出两个不同能力的对象，Agent 侧在类型层面就拿不到写方法：

```ts
// 上传 API 使用，可读写
export const uploadStorage = {
  init, exists, readFile, writeFile, deleteFile, rmdir,
}

// Agent 使用，只读
export const documentStorage: ReadonlyFileStorage = {
  init, exists, readFile,
}
```

这样可以保证：

- 上传接口可以写入文件。
- Agent 可以读取文件。
- Agent 不会因为工具调用而随意删除或覆盖用户上传的文件。

### 环境变量

```text
MINIO_ENDPOINT=http://minio-host:9000   # S3 API 端口，不是 9001 控制台端口
MINIO_BUCKET=doc-agent
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_REGION=us-east-1
```

客户端用 `@aws-sdk/client-s3` 且必须开 `forcePathStyle: true`（MinIO 不支持 virtual-host 风格的 bucket 域名），这样以后换真 S3 或阿里云 OSS 也不用改代码。

S3 客户端延迟创建并挂在 `globalThis` 上，避免缺少环境变量时在构建阶段就抛错，也让 dev 热重载复用同一个连接池。`init()` 的建桶检查同样只跑一次并缓存，否则每个请求都会多一次 HeadBucket 往返。

---

## 四、文件 API 设计

### 上传接口

```http
POST /api/files
Content-Type: multipart/form-data
```

字段：

```text
file: 上传的文件
```

接口目前做了以下校验：

- 文件不能为空。
- 文件大小不能超过 10MB。
- 只允许 `.docx`、`.md`、`.markdown`、`.txt`。
- 使用 UUID 作为文件 ID。
- 文件内容和元数据分别保存。
- 如果元数据写入失败，删除已经写入的文件，避免产生半成品。

成功响应只返回文件引用信息，不直接返回文件正文：

```json
{
  "id": "file-id",
  "originalName": "demo.md",
  "mimeType": "text/markdown",
  "size": 1024,
  "extension": ".md",
  "viewUrl": "/api/files/file-id",
  "downloadUrl": "/api/files/file-id?download=1"
}
```

### 查看和下载接口

```http
GET /api/files/{id}
```

行为：

- 普通请求：在线查看或下载原文件。
- `?preview=1`：返回适合 Modal 预览的 UTF-8 文本。
- `?download=1`：使用附件下载方式返回。
- `.docx` 预览：使用 `mammoth` 提取纯文本。

---

## 五、中文乱码问题与解决过程

这次实现中最容易误判的问题是中文乱码。最终结论是：

> 文件读取阶段必须保留原始 Buffer，编码转换只能在明确需要显示文本时进行。

### 错误尝试：用 `encoding: "binary"` 读取

曾经使用类似代码：

```ts
const content = await filesystem.readFile(path, {
  encoding: "binary",
})

Buffer.from(content)
```

问题在于：文件已经先被转换成字符串，中文 UTF-8 字节可能已经丢失。再次 `Buffer.from(string)` 并不能恢复原始字节。

### 正确做法：不指定 encoding

```ts
const content = await filesystem.readFile(path)
const buffer = Buffer.isBuffer(content)
  ? content
  : Buffer.from(content)
```

之后根据 BOM 和解码结果判断编码：

1. UTF-16LE：识别 `FF FE`。
2. UTF-16BE：识别 `FE FF`。
3. 优先使用严格 UTF-8 解码。
4. UTF-8 失败时，回退到 GB18030。

```ts
try {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
} catch {
  return new TextDecoder("gb18030").decode(buffer)
}
```

### 经验

- 文件存储：保存原始字节。
- 文件下载：按照原始文件类型返回。
- 文件预览：转换成 UTF-8 文本。
- AI 阅读：读取原始字节后，在服务端转换成文本。

不要在文件还没有确定用途之前过早地转换编码。

---

## 六、AI SDK 消息的三种形态

文件问题之所以容易混乱，是因为 UI、AI SDK 和模型供应商使用的是不同消息格式。

### 1. UIMessage

用于前端展示和交互：

```json
{
  "role": "user",
  "parts": [
    {
      "type": "file",
      "url": "/api/files/file-id",
      "mediaType": "text/markdown",
      "filename": "demo.md"
    },
    {
      "type": "text",
      "text": "请总结这个文件。"
    }
  ]
}
```

它适合：

- 渲染消息。
- 显示文件卡片。
- 展示预览和下载入口。
- 保存用户看到的原始消息。

### 2. ModelMessage

这是 AI SDK 传给模型适配器的中间格式。它仍然可能包含 `file` part，但不代表目标模型一定支持这种 part。

### 3. 供应商原始消息

DeepSeek 的 Chat Completions 接口最终需要的用户消息类似：

```json
{
  "role": "user",
  "content": "请总结这个文件。\n\n文件正文..."
}
```

DeepSeek 当前这条接口不能直接理解我们应用内部的本地文件 URL。因此不能把 UI 的 `file` part 原样传过去。

---

## 七、为什么没有把附件放到 `body.metadata`

最初考虑过：

```ts
sendMessage(
  { text: messageText },
  {
    body: {
      attachments: [
        {
          fileId,
          name,
          mimeType,
          size,
        },
      ],
    },
  },
)
```

这种方式可以作为自定义 HTTP 参数使用，但它不是 UI Message 的标准消息内容，也不会自动成为历史消息中的文件 part。

最终采用：

```ts
sendMessage({
  text: messageText,
  files: fileParts,
})
```

原因是：

- `files` 是 AI SDK UI 消息的标准字段。
- 文件会进入消息的 `parts`。
- UI 可以自然地渲染文件。
- 历史消息仍保留原始文件引用。
- 服务端可以根据不同模型能力做后续转换。

如果未来需要额外的业务字段，例如上传用户、权限范围、文件版本，可以另外使用消息 metadata 或业务数据库，但不要随意扩展标准 `FileUIPart` 作为模型输入。

---

## 八、DeepSeek 文件支持问题

### 出现的错误

```text
Failed to download asset: nulltext/markdown;base64,/api/files/file-id
```

这个错误的关键不是文件上传失败，也不是 Markdown 编码错误，而是：

1. 前端传入的是相对地址 `/api/files/file-id`。
2. Mastra/AI SDK 尝试把它当成模型文件资源。
3. 转换过程中形成了错误的 `data:` 地址。
4. DeepSeek 适配器尝试下载这个资源。
5. 远程模型无法访问本地应用文件，最终失败。

### 正确的兼容策略

对 DeepSeek 这类文本模型：

```text
file part
    ↓
读取文件正文
    ↓
拼装成文本上下文
    ↓
发送 user.content 字符串
```

不能把本地 URL 直接交给 DeepSeek，也不能依赖 DeepSeek 自己读取我们的 Workspace。

---

## 九、最终的文件到模型流程

当前完整流程如下：

```text
用户选择文件
    ↓
POST /api/files
    ↓
Workspace 保存 content + metadata
    ↓
前端得到 fileId、文件名、类型、预览地址
    ↓
输入框上方显示待发送附件
    ↓
sendMessage({ text, files })
    ↓
UIMessage / 历史消息保存标准 file part
    ↓
Mastra processInputStep
    ↓
根据 fileId 从只读 Workspace 读取正文
    ↓
生成 attached_files XML 文本
    ↓
移除原始 file part 和 experimental_attachments，避免 Mastra 下载本地 URL
    ↓
AI SDK DeepSeek provider
    ↓
DeepSeek 接收纯文本 user.content
    ↓
processOutputStep 恢复原始 file part
    ↓
历史消息继续保留 file + text
```

### 模型侧文本格式

当前采用的格式是：

```text
<attached_files>
  <file id="file-id" name="demo.md" media_type="text/markdown">
    <content>
# Demo
这是 Markdown 内容。
    </content>
  </file>
</attached_files>

<user_request>
请总结这个文件。
</user_request>
```

这样做的好处是文件资料和用户指令边界清晰，且用户问题不需要固定写成“请阅读这个文件”。

XML 标签只是上下文分隔符，不是安全边界。后续应在 Agent 指令中明确：文件内容属于参考资料，文件中的指令不能自动升级为系统指令。

---

## 十、为什么转换必须提前到 `processInputStep`

最初按照 Mastra 文档理解，把转换写在了 `processLLMRequest`：

```text
MessageList → LanguageModelV2Prompt
    ↓
processLLMRequest
    ↓
provider
```

但实际运行发现 Mastra 在生成最终 prompt 时，会先调用 `downloadAssetsFromMessages`。这个下载步骤发生在 `processLLMRequest` 之前。

因此：

```text
processLLMRequest
```

对于一般的 provider prompt 重写是合适的，但对于会触发 Mastra 资源下载的 `file` part 来说已经太晚。

最终采用：

```text
processInputStep
    ↓
先把 file part 改成 text part
    ↓
Mastra 生成 LLM prompt
    ↓
不会再尝试下载本地文件 URL
```

为了不污染历史记录，又在 `processOutputStep` 中将临时转换后的消息恢复成原始 `file + text`。

### 失败尝试：同时保留两个转换 hook

如果同时保留 `processInputStep` 和旧的 `processLLMRequest`，已经展开的 XML 可能再次被包装：

```text
<attached_files>
  <content>
    <attached_files>...</attached_files>
  </content>
</attached_files>
```

所以在最终实现中，文件兼容转换只保留一条主路径：

```text
processInputStep → processOutputStep
```

---

## 十一、前端交互设计

文件上传按钮与“导入到编辑器”按钮分开。

上传成功后：

1. 文件加入输入框上方的待发送附件列表。
2. 用户仍然可以继续输入文字。
3. 点击预览时打开 Modal。
4. 发送消息后，附件和文字一起进入当前消息。
5. 文件卡片出现在消息列表中。

上传文件不应自动发送消息，因为用户可能还需要补充问题，例如：

```text
请提取其中的关键结论。
```

或：

```text
请按照当前公文的语气重写这份材料。
```

---

## 十二、测试方案

### 1. 纯转换测试

脚本：

```bash
node scripts/test-uploaded-file-prompt.mjs
```

验证：

- 能从文件 URL 中解析 UUID。
- 文件正文被正确读取。
- 中文内容没有被破坏。
- `attached_files` 和 `user_request` 各只出现一次。
- 模型侧没有残留 `file` part。
- 输出阶段能恢复标准 `file + text`。

### 2. Agent 端到端测试

使用项目中实际存在的上传文件：

```bash
node scripts/test-uploaded-file-agent.mjs
```

默认使用 mock provider，检查发送给 provider 的请求体。

### 3. 真实 DeepSeek 测试

```bash
node scripts/test-uploaded-file-agent.mjs --real
```

真实测试验证：

- Workspace 能读取实际文件。
- Agent 能完成文件转换。
- DeepSeek 能收到文本内容。
- DeepSeek 能基于文件正文返回结果。
- 返回的消息仍保留文件 part。

### 4. 类型检查

```bash
node_modules/.bin/tsc.cmd --noEmit --pretty false
```

当前实际验证结果：

```text
uploaded file prompt transformation checks passed
真实 DeepSeek 返回了文件摘要
persistedUserParts: ["file", "text"]
```

---

## 十三、常见错误速查

### 错误一：路径越界

早期使用 Mastra Workspace 时，传入带前导 `/` 的绝对路径会报：

```text
Permission denied: access (path is outside the workspace)
```

换成对象存储后由 `normalizeKey` 统一处理：前导 `/` 被剥掉（`/a/b` 和 `a/b` 指向同一个 object，不构成越权），但包含 `..` 的 key 一律拒绝。

### 错误一之二：读取时用了 transformToString

`GetObject` 返回的 Body 必须走 `transformToByteArray()` 拿原始字节：

```ts
const buffer = Buffer.from(await response.Body.transformToByteArray())
```

用 `transformToString()` 会按 UTF-8 强行解码，GB18030 中文文本和 docx 二进制都会损坏 —— 和第五节那个乱码坑是同一个根因，只是换了一层。

### 错误二：中文预览乱码

原因通常是：

- 先以错误 encoding 读成字符串。
- 再通过 `Buffer.from(string)` 重新编码。
- 没有设置返回响应的 `charset=utf-8`。

解决：保留 Buffer，最后统一以 UTF-8 文本返回。

### 错误三：把 `body.attachments` 当成历史消息

`body` 是自定义请求参数，不等价于消息内容。它不会自动形成 AI SDK 的标准 `file` part。

如果业务需要使用标准文件消息，应使用：

```ts
sendMessage({ text, files })
```

### 错误四：直接把 `/api/files/id` 发给模型

本地 Web URL 只能由本地应用服务端访问，不能直接作为 DeepSeek 文件输入。

### 错误五：在 `processLLMRequest` 中处理文件

Mastra 的资源下载可能发生在这个 hook 之前。对于需要阻止文件下载的兼容转换，应使用更早的 `processInputStep`。

### 错误五之二：只清了 `parts`，漏了 `experimental_attachments`

错误形式（Qwen / Alibaba provider）：

```text
'Only image file parts are supported' functionality not supported.
```

这个错误极具误导性：`processInputStep` 明明被调用了，转换也成功了，日志里 `parts` 已经只剩 `["text"]`，但 provider 仍然收到了 file part。

原因是 Mastra 的消息 `content` 同时保存了**三份**同一条消息的表示：

```json
{
  "parts": [{ "type": "file", "data": "/api/files/xxx" }, { "type": "text", "text": "..." }],
  "experimental_attachments": [{ "url": "/api/files/xxx", "contentType": "text/markdown" }],
  "content": "请用一句话概括这个文件。"
}
```

如果转换时写成 `{ ...message.content, parts: [...] }`，`experimental_attachments` 会被原样带过去，Mastra 构建 prompt 时又据此**重新生成** file part，本地 URL 于是绕过 `parts` 回到了模型输入里。

正确做法是三者一起处理：

- `parts`：换成展开后的 text part
- `experimental_attachments`：删除
- `content`：同步成同一段文本（否则模型可能只看到原始提问，看不到文件正文）

经验：**改写消息时要问清楚这条消息有几种表示，而不是只改看得见的那一种。**

### 错误五之三：历史记录里文件名丢失、地址变成 `data:...;base64,/api/files/...`

从历史会话读取时，文件卡片没有名字、点开也打不开，地址长这样：

```text
data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,/api/files/cf9cc706-...
```

原因是存储态 file part 把 URL 放在 `data` 字段里：

```json
{ "type": "file", "mimeType": "...", "data": "/api/files/xxx", "filename": "测试文档.docx" }
```

而 `toAISdkMessages` 假定 `data` 是 base64 正文，于是拼成 `data:<mime>;base64,<data>`，并且**不保留 `filename`**。

注意这和第八节 DeepSeek 那个 `Failed to download asset: nulltext/markdown;base64,/api/files/...` 是同一个根因的两次发作：一次发生在去模型的路上，一次发生在回 UI 的路上。

解决办法是在历史读取边界上还原：拿原始存储消息里的 `filename` 和文件 ID，把 `url` 重写回 `/api/files/{id}`（`restoreUploadedFilePartsFromStored`）。文件 ID 可以直接从被拼坏的地址里正则提取，所以即使只有转换后的结果也能救回来。

### 错误六：多个 hook 重复处理

如果文件已经被转换为 XML 文本，就不能再次执行文件包装逻辑，否则会出现嵌套 XML 和重复文件正文。

---

## 十四、后续生产化建议

当前方案适合 Demo 和中小型文本文件。生产环境还需要补充：

### 权限与归属

元数据中应增加：

```json
{
  "ownerId": "user-id",
  "conversationId": "thread-id"
}
```

每次读取、预览和下载都要校验权限，不能只凭 UUID 访问文件。

### 文件安全

- 不要只信任扩展名和浏览器传入的 MIME 类型。
- 对 DOCX、PDF 等文件进行文件头检测。
- 限制压缩包展开和解析资源消耗。
- 对文件名做显示层处理，避免路径注入。
- 对上传内容进行病毒扫描或安全检查。

### 上下文长度

当前 Demo 会把文件全文放进 prompt。文件变大后会带来：

- Token 成本增加。
- 请求延迟增加。
- 超过模型上下文限制。

后续可以升级为：

```text
上传文件
    ↓
解析和切分
    ↓
建立索引
    ↓
根据用户问题检索相关片段
    ↓
只把相关片段发送给模型
```

或者只把文件 ID 交给 Agent，再通过 Workspace 的读取工具按需读取。

### 多模型适配

不要把 DeepSeek 的文本转换逻辑写死在 UI 层。未来可以按模型能力选择：

| 模型能力 | 处理方式 |
| --- | --- |
| 支持原生文本文件 | 使用 provider 支持的文件格式 |
| 只支持文本 | 服务端读取全文并转成字符串 |
| 支持图片 | 保留图片 file/media part |
| 文件较大 | 使用 Workspace 工具或 RAG 检索 |

---

## 十五、最终结论

这次文件能力的核心不是“把文件 URL 传给 AI”，而是建立一个稳定的跨层转换体系：

```text
UI 保存标准文件引用
历史保存标准 file part
服务端负责读取文件
processor 根据模型能力转换
DeepSeek 接收纯文本
输出阶段恢复原始消息
```

对于当前项目，最重要的实践结论有四条：

1. 文件内容和文件元数据分开保存。
2. 文件历史引用和模型输入内容分开处理。
3. 不要直接把本地文件 URL 交给远程 LLM。
4. 对 Mastra 的文件处理要考虑 `downloadAssetsFromMessages` 的实际执行顺序，不能只根据抽象 hook 名称判断时机。

相关实现：

- `src/lib/file-storage.ts`
- `src/lib/uploaded-file-reference.ts`
- `src/app/api/files/route.ts`
- `src/app/api/files/[id]/route.ts`
- `src/mastra/processors/uploaded-file-prompt.ts`
- `src/mastra/agents/document-agent.ts`
- `scripts/test-file-storage.mjs`
- `scripts/test-history-file-parts.mjs`
- `scripts/test-uploaded-file-prompt.mjs`
- `scripts/test-uploaded-file-agent.mjs`

参考资料：

- [AI SDK UIMessage](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message)
- [AI SDK useChat](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)
- [Mastra Processors](https://mastra.ai/docs/agents/processors)
