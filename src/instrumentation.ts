export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // 数据库客户端都是延迟创建的，配置缺失不会在构建阶段暴露。
  // 这里在服务启动时校验一次，别把配置错误拖到第一个请求才发现。
  const { getDatabaseConnectionConfig } = await import('./db/environment');
  getDatabaseConnectionConfig();

  const { ensureSystemMaterials } = await import(
    './mastra/document/materials'
  );
  await ensureSystemMaterials();
}
