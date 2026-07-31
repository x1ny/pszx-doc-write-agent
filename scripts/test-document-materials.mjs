import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  ensureSystemMaterials,
  readDocumentMaterialText,
} = await jiti.import('../src/mastra/document/materials.ts');

const firstRun = await ensureSystemMaterials();
const secondRun = await ensureSystemMaterials();

if (firstRun.length !== 4 || secondRun.length !== 4) {
  throw new Error('系统材料初始化结果数量不正确。');
}

if (
  firstRun.some(
    (material) =>
      material.sourceType !== 'system' ||
      !material.viewUrl ||
      !material.downloadUrl
  )
) {
  throw new Error('系统材料没有生成统一材料描述。');
}

const article = await readDocumentMaterialText(firstRun[0].id);
if (article.length === 0) {
  throw new Error('系统材料正文读取结果为空。');
}

console.log(
  JSON.stringify(
    {
      count: firstRun.length,
      ids: firstRun.map((material) => material.id),
      firstArticleLength: article.length,
      idempotent: firstRun.map((material) => material.id).join(',') ===
        secondRun.map((material) => material.id).join(','),
    },
    null,
    2
  )
);
