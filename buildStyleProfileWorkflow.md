# 写作风格画像 Workflow 设计

## 1. 目标

实现一个通用的 `buildStyleProfileWorkflow`，用于：

> 根据指定人物检索相关历史材料，让用户确认参考材料后，对多篇材料并发进行写作风格分析，最终生成统一的 `StyleProfile`。

该 Workflow **只负责生成 StyleProfile，不负责修改文章**。

后续如何使用 StyleProfile，由外层 ReAct Agent 根据用户意图决定。

例如：

```text
用户：
“帮我总结陈局长的写作风格”

Agent
  ↓
buildStyleProfileWorkflow
  ↓
StyleProfile
  ↓
直接向用户展示总结
```

```text
用户：
“把当前文章改成陈局长的风格”

Agent
  ↓
检查是否已有可用 StyleProfile
  ↓
没有
  ↓
buildStyleProfileWorkflow
  ↓
StyleProfile
  ↓
rewriteDocument Tool
  ↓
updateDocument Tool
```

如果已有 StyleProfile，则应直接复用，不重新执行 Workflow。

---

# 2. Workflow 边界

Workflow 内负责：

```text
检索候选材料
    ↓
用户选择参考材料
    ↓
暂停
    ↓
用户确认
    ↓
恢复执行
    ↓
并发分析每篇文章
    ↓
聚合分析结果
    ↓
生成 StyleProfile
```

Workflow 外负责：

```text
用户意图理解
是否需要 StyleProfile
是否复用已有 StyleProfile
StyleProfile 生成后做什么
是否修改当前文章
如何修改文章
```

因此不要实现成：

```text
buildStyleProfileAndRewriteWorkflow
```

避免将“风格分析”和“文章改写”耦合。

---

# 3. Workflow 输入

建议 Schema：

```ts
interface BuildStyleProfileInput {
  subject: {
    type: "person";
    name: string;

    // 用于人物消歧
    organization?: string;
    department?: string;
    position?: string;
  };

  searchOptions?: {
    dateRange?: {
      start?: string;
      end?: string;
    };

    documentTypes?: string[];

    maxCandidates?: number;
  };

  // 可选：用户已经指定了一些材料
  initialDocumentIds?: string[];

  // 当前会话/任务 ID，用于结果关联
  conversationId?: string;
}
```

示例：

```ts
{
  subject: {
    type: "person",
    name: "陈局长",
    organization: "泉州市农业农村局"
  },

  searchOptions: {
    maxCandidates: 20
  }
}
```

---

# 4. Workflow 输出

```ts
interface BuildStyleProfileOutput {
  styleProfile: StyleProfile;

  sourceDocuments: StyleSourceDocument[];
}
```

其中：

```ts
interface StyleProfile {
  id: string;

  subject: {
    type: "person" | "documents";
    name?: string;
    organization?: string;
  };

  sourceDocumentIds: string[];

  summary: string;

  traits: {
    structure: StyleTrait[];
    sentencePatterns: StyleTrait[];
    vocabulary: StyleTrait[];
    rhetoric: StyleTrait[];
    dataUsage: StyleTrait[];
    commonExpressions: StyleTrait[];
    tone: StyleTrait[];
  };

  avoidPatterns?: StyleTrait[];

  confidence: number;

  createdAt: string;
}
```

建议 StyleTrait：

```ts
interface StyleTrait {
  description: string;

  // high / medium / low
  strength: "high" | "medium" | "low";

  // 支撑该判断的文档
  sourceDocumentIds: string[];

  evidence?: string[];
}
```

StyleProfile 必须保留 `sourceDocumentIds`。

以后需要知道：

> 这个“陈局长风格”到底是根据哪些文章得出的？

否则画像会变成不可追溯的 LLM 文本。

---

# 5. Workflow 总体结构

```text
┌──────────────────────────────┐
│ buildStyleProfileWorkflow    │
└──────────────┬───────────────┘
               │
               ▼
      ① searchReferences
               │
               ▼
      ② prepareSelection
               │
               ▼
           SUSPEND
               │
        用户增删候选文章
               │
          RESUME
               │
               ▼
      ③ loadDocuments
               │
               ▼
      ④ analyzeDocuments
          foreach / 并发
        ┌──────┼──────┐
        ▼      ▼      ▼
       Doc1   Doc2   Doc3 ...
        └──────┼──────┘
               │
               ▼
      ⑤ synthesizeProfile
               │
               ▼
      ⑥ persistStyleProfile
               │
               ▼
          StyleProfile
```

---

# 6. Step 1：检索候选材料

Step：

```text
searchReferences
```

职责：

根据人物信息搜索系统知识库中的相关文章。

例如：

```ts
searchDocuments({
  author: "陈局长",
  organization: "泉州市农业农村局",
  dateRange,
  documentTypes
})
```

建议输出：

```ts
interface StyleSourceCandidate {
  id: string;

  title: string;

  author?: string;

  organization?: string;

  documentType?: string;

  date?: string;

  summary?: string;

  relevanceScore?: number;

  // 为什么认为它属于目标人物
  matchReason?: string;
}
```

### 注意

人物查询必须支持消歧。

例如：

```text
“农业局陈局长”
```

不要只搜索：

```text
author = 陈局长
```

而应该结合：

```text
姓名
+
单位
+
职务
+
当前用户上下文
```

尽量确定目标人物。

---

# 7. Step 2：用户确认参考材料

搜索完成后不要立即开始分析。

Workflow 应暂停，并向前端输出：

```ts
interface StyleReferenceSelectionPayload {
  type: "style-reference-selection";

  subject: {
    name: string;
    organization?: string;
  };

  candidates: StyleSourceCandidate[];

  defaultSelectedDocumentIds: string[];
}
```

然后：

```text
suspend
```

Mastra Workflow 支持在步骤中 suspend，并持久化当前 Workflow 状态；用户完成选择后可以从原执行位置 resume。

---

# 8. 前端交互

前端不要把这个步骤退化成普通 Chat 文本：

```text
“我找到 12 篇文章，你想选择哪几个？”
```

应该渲染结构化 UI。

示意：

```text
已找到陈局长相关材料 12 篇

☑ 2026年全市农业农村工作会议讲话
☑ 关于农村集体“三资”管理工作的讲话
☑ 全市乡村振兴工作推进会讲话
☐ 2025年度农业农村工作总结
☐ 调研洛江区农业工作时的讲话

[ + 添加其他材料 ]

                  [确认参考材料]
```

用户可以：

```text
取消选择
增加选择
上传其他材料
追加知识库材料
```

点击“确认参考材料”后，前端直接 Resume Workflow。

Resume 输入：

```ts
interface StyleReferenceSelectionResult {
  selectedDocumentIds: string[];

  // 如果用户临时上传了额外材料
  additionalDocumentIds?: string[];
}
```

不要转换成自然语言重新发送给 Agent：

```text
“好的，我选第一、二、五篇”
```

因为这是已经确定的结构化状态，不需要再次让 LLM 解析。

---

# 9. Step 3：读取最终材料

Resume 后：

```text
selectedDocumentIds
      ↓
loadDocuments
```

加载真正需要分析的文章内容。

Workflow Snapshot / State 中尽量保存：

```text
documentId
```

而不是长期保存所有文章全文。

大文本在执行时根据 ID 获取。

---

# 10. Step 4：并发分析多篇文章

最终文章数量是动态的，因此应该使用动态批处理，而不是写死：

```text
parallel([
  doc1,
  doc2,
  doc3
])
```

建议使用：

```text
foreach selectedDocument
```

并设置合理的 concurrency。

例如：

```text
10 篇文章

并发度 = 3~5

第一批：
A B C D

第二批：
E F G H

第三批：
I J
```

不要无限并发调用 LLM。

Mastra 当前 `foreach` 非常适合这类动态 fan-out 场景，而且能够产生逐项进度事件，如 `completedCount / totalCount / currentIndex / iterationStatus`，可直接用于前端显示处理进度。

前端可以显示：

```text
正在分析陈局长历史材料

✓ 工作会议讲话
✓ 乡村振兴会议讲话
● 三资管理工作讲话
○ 调研讲话
○ 年度总结

已完成 2 / 5
```

---

# 11. 单篇 Style Analysis

现有的写作风格解析能力应该抽成 Domain Function。

不要让 Workflow 强依赖 Tool wrapper。

推荐：

```text
domain/
  style/
    analyze-document-style.ts
```

```ts
async function analyzeDocumentStyle(
  document: DocumentContent
): Promise<DocumentStyleAnalysis>
```

已有 Tool：

```text
analyzeWritingStyleTool
```

内部调用该 Domain Function。

Workflow：

```text
analyzeDocuments foreach
```

同样直接调用该 Domain Function。

即：

```text
                 analyzeDocumentStyle()
                         ▲
            ┌────────────┴────────────┐
            │                         │
       Agent Tool                Workflow Step
```

避免：

```text
Workflow
  ↓
Tool
  ↓
Service
```

造成无意义的层层包装。

---

# 12. 单篇分析必须输出结构化结果

不要让每篇文章返回：

```text
“文章语言简练，逻辑清晰，善于使用数据……”
```

这种无法稳定聚合的自由文本。

建议：

```ts
interface DocumentStyleAnalysis {
  documentId: string;

  structure: {
    patterns: string[];
    evidence: string[];
  };

  sentenceStyle: {
    patterns: string[];
    evidence: string[];
  };

  vocabulary: {
    preferred: string[];
    expressions: string[];
    evidence: string[];
  };

  rhetoric: {
    patterns: string[];
    evidence: string[];
  };

  dataUsage: {
    patterns: string[];
    evidence: string[];
  };

  tone: {
    patterns: string[];
    evidence: string[];
  };

  distinctiveFeatures: {
    description: string;
    evidence: string[];
  }[];

  confidence: number;
}
```

重点是：

```text
特征 + evidence
```

而不是只有特征。

---

# 13. Step 5：聚合 StyleProfile

输入：

```text
DocumentStyleAnalysis[]
```

调用一次专门的 LLM 方法：

```ts
synthesizeStyleProfile(analyses)
```

这一层不是简单 summarize。

必须完成：

```text
多个单篇分析
       ↓
寻找重复稳定特征
       ↓
排除偶发特征
       ↓
区分文种特征 / 个人特征
       ↓
生成统一 StyleProfile
```

例如：

如果只有一篇讲话稿大量出现：

```text
“同志们”
```

不能因此把：

```text
经常使用“同志们”
```

定义为陈局长个人风格。

因为它可能只是“讲话稿”的文种特征。

聚合 Prompt 应明确要求区分：

```text
1. 多篇文章稳定存在的个人风格特征
2. 特定文种导致的表达特点
3. 只在个别文章出现的偶发现象
```

最终重点保留：

```text
稳定、跨材料重复出现的写作习惯
```

---

# 14. StyleProfile 强度

建议不要简单输出一个扁平列表。

例如：

```ts
{
  sentencePatterns: [
    {
      description: "偏好短句和并列句组合",
      strength: "high",
      sourceDocumentIds: ["1", "2", "4", "5"]
    },

    {
      description: "偶尔使用设问句引出重点",
      strength: "low",
      sourceDocumentIds: ["3"]
    }
  ]
}
```

后续进行风格改写时：

```text
high traits
   ↓
强约束

medium traits
   ↓
参考

low traits
   ↓
尽量不要强行模仿
```

避免过度拟合某一篇文章。

---

# 15. Step 6：持久化 StyleProfile

StyleProfile 不应该只作为 Workflow output 返回。

建议保存为领域对象：

```text
style_profiles
```

至少包含：

```ts
{
  id,

  subjectType,
  subjectName,
  organization,

  sourceDocumentIds,

  profile,

  confidence,

  createdAt,
  updatedAt
}
```

后续 Agent 可以：

```text
getStyleProfile({
  person: "陈局长",
  organization: "泉州市农业农村局"
})
```

如果存在可信 Profile：

```text
直接复用
```

避免每次：

```text
search
→ 用户确认
→ analyze
→ aggregate
```

---

# 16. Profile 缓存 / 更新策略

StyleProfile 应记录：

```text
sourceDocumentIds
sourceDocumentVersions
createdAt
```

如果：

```text
材料集合没有变化
```

优先复用。

如果：

```text
新增大量材料
```

可以重新构建或提供：

```text
“已有陈局长写作风格画像，最近新增 8 篇材料，是否重新分析？”
```

Demo 阶段可以先简单实现：

```text
有 Profile → Agent 优先使用
用户明确要求重新分析 → 重跑 Workflow
```

---

# 17. 外层 Agent 的职责

Agent 不需要知道 Workflow 内部：

```text
foreach
suspend
aggregate
```

它只需要理解：

```text
buildStyleProfile
```

能力描述类似：

```text
根据指定人物的历史材料建立写作风格画像。

适用于：
- 用户希望了解某人的写作风格；
- 后续任务需要使用某人的写作风格，但当前没有可信 StyleProfile。

该能力可能要求用户确认用于分析的参考材料。
```

Agent 自己决定什么时候调用。

---

# 18. 三个典型场景

## 场景 A：上传文档直接分析

用户：

```text
帮我分析刚才上传的三篇文章是什么风格。
```

不进入 Workflow。

```text
Agent
 ↓
analyzeWritingStyle Tool
 ↓
StyleProfile
 ↓
回答
```

因为参考材料已经明确，不需要“搜索 + 用户选择”。

---

## 场景 B：分析某个人的风格

用户：

```text
帮我分析一下农业局陈局长平时的写作风格。
```

执行：

```text
Agent
 ↓
检查 StyleProfile
 ↓
不存在
 ↓
buildStyleProfileWorkflow
 ↓
搜索候选材料
 ↓
用户确认
 ↓
并发分析
 ↓
聚合
 ↓
StyleProfile
 ↓
Agent 向用户总结
```

---

## 场景 C：按某个人风格改写

用户：

```text
文章结构挺好的，但是我希望改成农业局陈局长的写作风格，你调整一下。
```

执行：

```text
Agent
 ↓
识别：
targetStyle = 陈局长
preserveStructure = true
 ↓
检查 StyleProfile
```

### 已有 Profile

```text
getStyleProfile
 ↓
rewriteDocument
 ↓
validateDocument
 ↓
updateDocument
```

### 没有 Profile

```text
buildStyleProfileWorkflow
 ↓
StyleProfile
 ↓
rewriteDocument
 ↓
validateDocument
 ↓
updateDocument
```

注意：

```text
rewriteDocument
```

不属于 `buildStyleProfileWorkflow`。

---

# 19. 改写 Tool 的建议接口

后续建议：

```ts
rewriteDocument({
  documentId,

  styleProfileId,

  instruction,

  constraints: {
    preserveStructure?: boolean;
    preserveFacts?: boolean;
    preserveNumbers?: boolean;
    preservePolicyMeaning?: boolean;
  }
})
```

例如：

```ts
rewriteDocument({
  documentId: currentDocumentId,

  styleProfileId: chenProfile.id,

  instruction: "调整为目标人物的写作风格",

  constraints: {
    preserveStructure: true,
    preserveFacts: true,
    preserveNumbers: true,
    preservePolicyMeaning: true
  }
})
```

---

# 20. Workflow 状态设计

建议 Workflow State 只保存必要信息：

```ts
interface BuildStyleProfileState {
  subject: PersonTarget;

  candidateDocumentIds: string[];

  selectedDocumentIds?: string[];

  analyses?: DocumentStyleAnalysis[];

  styleProfileId?: string;
}
```

避免长期保存：

```text
完整文档正文
大段 Prompt
完整 LLM message history
```

文档正文根据 ID 动态读取。

---

# 21. 错误处理

### 没找到材料

Workflow 不应该产生虚假 StyleProfile。

返回：

```text
INSUFFICIENT_STYLE_SOURCES
```

由 Agent 告诉用户：

```text
当前没有找到足够的陈局长材料，可以上传几份参考文章再进行分析。
```

---

### 用户只选择 1 篇

允许继续，但 StyleProfile：

```ts
confidence = low
```

并明确：

```text
当前画像仅基于一篇材料，可能包含较强的单篇文章特征。
```

---

### 某篇分析失败

foreach 中单篇失败不应该直接让整个 Workflow 崩掉。

策略：

```text
自动 retry 1~2 次
```

仍失败：

```text
记录 failedDocumentIds
```

如果剩余有效材料仍然足够：

```text
继续 aggregate
```

否则：

```text
Workflow failed / 请求用户重新选择
```

---

### 用户关闭页面

Workflow 必须可以通过：

```text
workflowRunId
```

继续恢复。

不要依赖浏览器内存保存当前进度。

Mastra Workflow 会持久化运行状态，并支持从 suspend 状态恢复；当前默认引擎也保持 suspend/resume 之间的 trace 连续性。

---

# 22. 并发控制

不要：

```ts
Promise.all(30篇LLM调用)
```

建议设置：

```text
concurrency = 3~5
```

实际数值配置化：

```ts
STYLE_ANALYSIS_CONCURRENCY
```

避免：

```text
LLM provider rate limit
瞬间 Token 峰值
单次 Workflow 成本失控
```

---

# 23. 可观察性

每个 Workflow run 至少记录：

```text
subject
候选材料数
用户最终选择数
分析成功数
分析失败数
总耗时
LLM 调用次数
StyleProfile confidence
```

Trace：

```text
buildStyleProfile
 ├─ searchReferences
 ├─ selectReferences
 ├─ analyzeDocuments
 │    ├─ doc1
 │    ├─ doc2
 │    └─ doc3
 ├─ synthesizeStyleProfile
 └─ persistStyleProfile
```

方便后续定位：

```text
到底是检索质量不行
还是单篇分析不行
还是聚合不行
```

---

# 24. 推荐代码目录

```text
src/
  agents/
    official-document-agent.ts

  workflows/
    build-style-profile/
      workflow.ts
      schemas.ts
      steps/
        search-references.ts
        select-references.ts
        load-documents.ts
        analyze-documents.ts
        synthesize-profile.ts
        persist-profile.ts

  tools/
    search-documents.ts
    analyze-writing-style.ts
    rewrite-document.ts
    get-style-profile.ts
    update-document.ts

  domain/
    style/
      analyze-document-style.ts
      synthesize-style-profile.ts
      style-profile.ts

  skills/
    writing-style/
      SKILL.md
```

---

# 25. 实现优先级

Demo 第一版先完成：

```text
P0

1. searchReferences
2. suspend + 用户选择
3. resume
4. foreach 并发分析
5. synthesizeStyleProfile
6. 返回 StyleProfile
7. Agent 能拿 StyleProfile 调 rewriteDocument
```

暂时不要优先做：

```text
Profile 自动增量更新
复杂人物实体系统
复杂 Profile versioning
非常细的失败恢复
长期 Profile 自动失效
```

先验证完整产品体验。

---

# 26. 最终架构原则

不要把这个 Workflow 理解成：

```text
“按陈局长风格改写”
```

它真正的能力应该是：

```text
buildStyleProfile(person)
```

即：

> 从一组经过用户确认的真实参考材料中，建立可复用、可追溯的写作风格画像。

至于 StyleProfile 生成以后：

```text
展示
比较
改写
仿写
生成新文章
```

全部由外层 ReAct Agent 根据用户当前目标自由决定。

因此整体结构应该保持：

```text
                     ReAct Agent
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
     analyzeStyle     buildStyleProfile   rewriteDocument
         Tool             Workflow             Tool
                            │
                     search references
                            ↓
                       user select
                            ↓
                         suspend
                            ↓
                          resume
                            ↓
                      foreach analyze
                            ↓
                         aggregate
                            ↓
                       StyleProfile
```

**Workflow 管理确定性的业务生命周期，Agent 决定为什么调用它、何时调用它，以及拿结果继续做什么。**
