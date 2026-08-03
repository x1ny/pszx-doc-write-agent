import mammoth from 'mammoth';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

/**
 * 校验风格分析中不经过模型的两层：指标测量与跨篇定档。
 *
 * 这两层是纯函数，先在真实材料上跑通，再去接模型，
 * 免得后面分不清是提示词的问题还是统计的问题。
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const corpusDir = resolve(projectRoot, 'src/assets/doc/农业局局长公文');

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { measureStyleMetrics, formatStyleMetrics } = await jiti.import(
  '../src/mastra/document/style-metrics.ts'
);
const { bandStyleFeatures, resolveBand } = await jiti.import(
  '../src/mastra/document/style-observation.ts'
);
const { renderStyleReport, renderStyleConstraints } = await jiti.import(
  '../src/mastra/document/style-profile-render.ts'
);

const files = (await readdir(corpusDir)).filter((name) => name.endsWith('.docx')).sort();
const documents = [];

for (const name of files) {
  const { value } = await mammoth.extractRawText({ path: resolve(corpusDir, name) });
  const metrics = measureStyleMetrics(value);
  documents.push({
    documentId: name.slice(0, 4),
    title: name.replace('.docx', ''),
    date: name.slice(0, 4),
    charCount: metrics.charCount,
    metrics,
  });
}

console.log('==================== 一、指标测量 ====================\n');
for (const document of documents) {
  console.log(`----- ${document.title} -----`);
  console.log(formatStyleMetrics(document.metrics));
  console.log('');
}

console.log('==================== 二、定档规则 ====================\n');
const refs = documents.map(({ documentId, title, date, charCount }) => ({
  documentId,
  title,
  date,
  charCount,
}));
const bandCases = [
  ['全部四篇', ['2023', '2024', '2025', '2026']],
  ['三篇', ['2023', '2025', '2026']],
  ['最近两篇', ['2025', '2026']],
  ['不相邻两篇', ['2023', '2025']],
  ['仅一篇', ['2026']],
  ['含无效 id', ['2026', 'unknown']],
];
for (const [label, ids] of bandCases) {
  console.log(`${label.padEnd(12)} → ${resolveBand(ids, refs)}`);
}
console.log(`单篇模式（总数 1）→ ${resolveBand(['2026'], refs.slice(-1))}`);

console.log('\n==================== 三、渲染产物 ====================\n');
const synthesis = {
  features: [
    {
      dimension: '开篇与收束',
      claim: '开篇层层挂靠明确议题，收束定性后归于号召',
      detail:
        '开篇以一句话交代会议议题，依次挂靠指导思想、中央部署与省委要求，再收拢为“总结—研判—部署”三事；结尾先以“责任重大”定性，继以团结奋斗的号召句作结。',
      supportingDocumentIds: ['2023', '2024', '2025', '2026'],
      constraint: '开篇一句话交代议题并依次挂靠上级要求，结尾先定性再以号召句收束。',
    },
    {
      dimension: '句式与语势',
      claim: '长句以短分句相衔，指令性语势贯穿全篇',
      detail:
        '平均句长约 50 字、长句占比过半，然句内以顿号并列与短分句层层递进，行文不显滞重。',
      supportingDocumentIds: ['2023', '2024', '2025', '2026'],
      constraint: '用长句但句内以顿号并列和短分句层层递进，平均每 80 字出现一次“要／必须／确保”。',
    },
    {
      dimension: '句式与语势',
      claim: '政策红线处转为递进式否定',
      detail: '“绝不能……更不能……严禁……”成组出现，近两年显著增强。',
      supportingDocumentIds: ['2025', '2026'],
      constraint: '涉及政策红线时使用递进式否定：绝不能……更不能……严禁……',
    },
    {
      dimension: '数据与例证',
      claim: '数据成串并缀以位次，例证取自亲历',
      detail: '述及成效时数据成串铺陈，其后常缀全国位次；举证偏取本人经手事项，鲜少援引外部案例。',
      supportingDocumentIds: ['2023', '2024', '2026'],
      constraint: '述及成效时数据成串铺陈并缀全国或全省位次，举证只取本地本人经手事项。',
    },
    {
      dimension: '遣词与表达',
      claim: '五年回顾用连续排比铺陈',
      detail: '连续五段以“五年来，我们……”起首。',
      supportingDocumentIds: ['2026'],
      constraint: '（应被判为偶发，不进正文）',
    },
  ],
  overview:
    '以指令性语势贯穿全篇，判断在前、举措居中、责任收口；善用动作性动词与引号凝练语，将复杂事项收束为可记可查的抓手，辅以成串数据与通俗设喻调节节奏，整体呈现面对面部署工作的讲话气质。',
  maxim: '先定判断，再列举措，终以责任收口。',
};

const profile = bandStyleFeatures({ subjectName: '陈明旺', documents: refs, synthesis });
console.log(renderStyleReport(profile));
console.log('\n--------------------- 风格约束 ---------------------\n');
console.log(renderStyleConstraints(profile));

console.log('\n==================== 四、单篇模式 ====================\n');
const singleProfile = bandStyleFeatures({
  subjectName: '陈明旺',
  documents: refs.slice(-1),
  synthesis: { ...synthesis, features: synthesis.features.slice(0, 2) },
});
console.log(renderStyleReport(singleProfile));
