import { config } from 'dotenv';
import mammoth from 'mammoth';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const startedAt = Date.now();

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultDocxPath = resolve(
  projectRoot,
  'src/assets/doc/农业局局长公文/2024年福建省农业农村厅工作报告.docx'
);

const defaultArticle = `# 关于推进数字政府建设的工作建议

当前，数字技术加快融入经济社会发展各领域，推进数字政府建设对提升治理效能具有重要意义。结合本地实际，提出以下建议。

## 一、夯实数字基础设施

加快政务数据目录建设，完善数据归集、共享和使用机制，推动跨部门业务协同。围绕重点场景建设一批示范应用，提升公共服务便利化水平。

## 二、提升基层治理能力

坚持问题导向，聚焦群众办事、风险防控和运行监管等重点环节，优化业务流程，明确责任分工，推动治理任务落到基层、落到具体岗位。

## 三、强化工作保障

加强统筹协调，细化时间安排和评价标准，定期分析建设成效，及时解决推进过程中出现的问题，确保各项任务取得实效。`;

function printHelp() {
  console.log(`用法：
  pnpm style:profile:test
  pnpm style:profile:test -- --docx ./article.docx
  pnpm style:profile:test -- --file ./article.md
  pnpm style:profile:test -- --text "待分析的公文原文"

参数：
  --docx <path>  从 DOCX 文件提取纯文本后分析
  --file <path>  从文件读取待分析的文章
  --text <text>  直接传入待分析的文章
  --help         显示帮助

不传参数时分析项目内的 2024 年农业农村厅工作报告。`);
}

async function readArticle() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const docxIndex = args.indexOf('--docx');
  if (docxIndex !== -1) {
    const docxPath = args[docxIndex + 1];
    if (!docxPath) {
      throw new Error('--docx 后面必须提供 DOCX 文件路径。');
    }

    const sourcePath = resolve(process.cwd(), docxPath);
    const result = await mammoth.extractRawText({ path: sourcePath });
    for (const message of result.messages) {
      console.error(`[DOCX][${message.type}] ${message.message}`);
    }
    return result.value;
  }

  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1) {
    const articlePath = args[fileIndex + 1];
    if (!articlePath) {
      throw new Error('--file 后面必须提供文章文件路径。');
    }
    return readFile(resolve(process.cwd(), articlePath), 'utf8');
  }

  const textIndex = args.indexOf('--text');
  if (textIndex !== -1) {
    const article = args.slice(textIndex + 1).join(' ').trim();
    if (!article) {
      throw new Error('--text 后面必须提供待分析的文章内容。');
    }
    return article;
  }

  if (args.length > 0) {
    return args.join(' ').trim();
  }

  const result = await mammoth.extractRawText({ path: defaultDocxPath });
  for (const message of result.messages) {
    console.error(`[DOCX][${message.type}] ${message.message}`);
  }
  return result.value || defaultArticle;
}

const article = (await readArticle()).trim();
if (!article) {
  throw new Error('待分析的文章内容不能为空。');
}

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { analyzeStyleProfile } = await jiti.import(
  '../src/mastra/document/style-profile.ts'
);
const styleProfile = await analyzeStyleProfile(article);

const elapsedMs = Date.now() - startedAt;
console.error(
  `[StyleProfile] 总运行时间：${elapsedMs} ms（${(elapsedMs / 1000).toFixed(2)} 秒）`
);
console.log(styleProfile);
