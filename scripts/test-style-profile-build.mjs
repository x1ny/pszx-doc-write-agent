import { config } from 'dotenv';
import mammoth from 'mammoth';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

/**
 * 端到端跑通多篇写作风格画像：观察 → 证据校验 → 汇总 → 定档 → 渲染。
 *
 * 默认使用项目内的四篇农业农村厅工作报告，可用 --dir 指向其他材料目录。
 */

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const nameIndex = args.indexOf('--name');
const corpusDir = resolve(
  projectRoot,
  dirIndex === -1 ? 'src/assets/doc/农业局局长公文' : args[dirIndex + 1]
);
const subjectName = nameIndex === -1 ? '陈明旺' : args[nameIndex + 1];

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStyleProfile } = await jiti.import(
  '../src/mastra/document/style-profile.ts'
);

const names = (await readdir(corpusDir)).filter((name) => name.endsWith('.docx')).sort();
if (!names.length) {
  throw new Error(`目录中没有 DOCX 材料：${corpusDir}`);
}

const documents = [];
for (const name of names) {
  const { value } = await mammoth.extractRawText({ path: resolve(corpusDir, name) });
  const title = name.replace(/\.docx$/, '');
  const year = title.match(/\d{4}/)?.[0] ?? title;
  documents.push({ documentId: year, title, date: year, article: value.trim() });
}

const startedAt = Date.now();
const { report, constraints, profile } = await buildStyleProfile({
  subjectName,
  documents,
});

console.error(
  `[StyleProfile] 材料 ${documents.length} 篇，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒，` +
    `正文特征 ${profile.features.length} 条，附注 ${profile.incidental.length} 条`
);
console.log(report);
console.log('\n\n=============== 风格约束（写作模型消费） ===============\n');
console.log(constraints);
