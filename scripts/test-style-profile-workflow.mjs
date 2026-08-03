import { config } from 'dotenv';
import { createJiti } from 'jiti';

// 检索参考材料要读文件存储，缺少 MINIO_* 变量时第一步就会失败。
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStyleProfileWorkflow } = await jiti.import(
  '../src/mastra/document/build-style-profile-workflow.ts'
);

const run = await buildStyleProfileWorkflow.createRun();
const result = await run.start({
  inputData: {
    subject: { name: '陈局长' },
  },
});

if (result.status !== 'suspended') {
  throw new Error('预期工作流暂停，但实际状态为：' + result.status);
}

console.log(JSON.stringify(result, null, 2));
