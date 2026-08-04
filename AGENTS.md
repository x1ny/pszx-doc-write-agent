<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 外部依赖一律延迟初始化

模块顶层不要读取环境变量、不要创建数据库/对象存储/模型客户端。`next build` 的
Collecting page data 阶段会 import 每一个 route handler 及其整条依赖链，而构建镜像里
没有任何运行时环境变量（`.dockerignore` 排除了 `.env*`），顶层求值会直接让构建失败，
且 `export const dynamic = "force-dynamic"` 挡不住——Next 必须先加载模块才能读到它。

正确写法是把校验和构造放进函数、按需缓存到 `globalThis`（顺带让 dev 热重载复用连接）：
`getDb()`、`getMastra()`、`getDocumentMemory()`、`getClient()`（file-storage）、
`createStyleProfileModel()` 都是这个模式。

配置缺失由 `src/instrumentation.ts` 在服务启动时统一校验并快速失败，不要为了提前暴露
配置错误而把校验搬回模块顶层。
