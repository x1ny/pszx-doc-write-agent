import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  shouldKeepWorkingMemoryReadOnly,
  shouldUseWorkingMemoryStyleRewrite,
  workingMemoryStyleActiveTools,
} = await jiti.import('../src/lib/style-routing.ts');

assert.equal(shouldUseWorkingMemoryStyleRewrite('风格改写'), true);
assert.equal(
  shouldUseWorkingMemoryStyleRewrite('请使用工作记忆中已经记住的写作风格改写'),
  true
);
assert.equal(
  shouldUseWorkingMemoryStyleRewrite('请学习李局长的写作风格并改写当前公文'),
  false
);
assert.equal(
  shouldUseWorkingMemoryStyleRewrite('请把当前公文改成李局长的写作风格'),
  false
);
assert.equal(
  shouldUseWorkingMemoryStyleRewrite('请使用记忆中的李局长风格改写'),
  true
);
assert.equal(
  shouldKeepWorkingMemoryReadOnly('改用李局长的风格进行改写'),
  true
);
assert.equal(
  shouldKeepWorkingMemoryReadOnly('请学习李局长的写作风格并改写当前公文'),
  true
);
assert.equal(
  shouldKeepWorkingMemoryReadOnly('风格改写，并保存为我的长期写作偏好'),
  false
);
assert.equal(workingMemoryStyleActiveTools.includes('simulateLeaderStyleAnalysis'), false);

console.log('style routing checks passed');
