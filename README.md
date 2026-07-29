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

## Docker 部署

当前项目使用 Next.js standalone 输出构建 Node.js 运行时镜像，容器监听 `3000` 端口。

本地构建并加载单架构镜像：

```bash
docker buildx build --platform linux/amd64 \
  --tag ps-docker-registry.cn-beijing.cr.aliyuncs.com/psdsframework/pszx-doc-write-agent:test \
  --file docker/Dockerfile --load .
```

使用发布脚本构建并推送镜像：

```bash
node scripts/build-push.js v0.1.0
node scripts/build-push.js v0.1.0 linux/amd64,linux/arm64
```

不传版本号时使用最新 Git tag。默认镜像仓库为：

```text
ps-docker-registry.cn-beijing.cr.aliyuncs.com/psdsframework/pszx-doc-write-agent
```

可通过 `IMAGE_REGISTRY`、`IMAGE_NAME` 和 `DOCKER_PLATFORM` 环境变量覆盖默认配置。

发布版本：

```bash
node scripts/release.js       # patch
node scripts/release.js minor
node scripts/release.js major
node scripts/release.js v1.0.0
```

发布脚本默认要求当前分支为 `main`，可通过 `RELEASE_MAIN_BRANCH` 覆盖。发布前会检查工作区干净、远程分支同步且版本 tag 不存在。

触发测试环境部署：

```powershell
$env:RANCHER_REDEPLOY_URL = "https://rancher.example/v3/.../redeploy"
$env:RANCHER_DEPLOY_TOKEN = "token-xxx:xxxxx"
$env:DEPLOY_INSECURE_TLS = "1" # 仅自签名证书环境需要
node scripts/deploy-test.js
```

测试部署脚本会先构建并推送 `:test` 镜像，再调用 Rancher redeploy API。Rancher 地址和 Token 不写入仓库。

容器运行时需要配置服务端环境变量：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `MASTRA_DB_URL`（Docker 镜像默认使用 `file:/app/data/mastra.db`）

示例：

```bash
docker run -d -p 3000:3000 \
  -v pszx-doc-write-agent-data:/app/data \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -e DEEPSEEK_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 \
  -e DEEPSEEK_MODEL=deepseek-v4-flash \
  ps-docker-registry.cn-beijing.cr.aliyuncs.com/psdsframework/pszx-doc-write-agent:v0.1.0
```
