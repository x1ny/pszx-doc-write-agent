import { createJiti } from 'jiti';

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
