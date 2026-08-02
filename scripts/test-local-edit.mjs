import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { locateLocalEdit } = await jiti.import(
  '../src/components/editor/local-edit/locate.ts'
);
const { restoreCjkQuotes } = await jiti.import(
  '../src/components/editor/local-edit/punctuation.ts'
);

// 以下两段正文取自会话 chat-bd8wStPdeh0BLvQ4 的真实快照，
// 它们在旧的全等匹配下都会失败。
const block7 =
  '本次整治旨在聚焦群众反映强烈、矛盾突出的“三资”管理乱象，通过全面排查、精准整治，实现“底数清、权属明、管理规范、监督有力”的工作目标。力争通过为期半年的专项整治，使全市村级集体经济组织财务公开透明率达到100%，不规范合同清理整改率达到95%以上，有效防范廉政风险，堵塞管理漏洞，建立健全长效监管机制，显著提升乡村治理水平和群众满意度。';

const block18 =
  '**（四）合同清理方面：严打“霸王合同”与“人情合同”**对现存的所有经济合同进行全面清理“回头看”。重点查处显失公平的“霸王合同”、违反民主程序的“人情合同”、期限过长且租金明显低于市场价的“历史遗留合同”。对于租金拖欠超过6个月或拒不履行合同的，依法启动追缴或解除程序。';

// 模型把正文里的全角引号写成了 ASCII 引号，折叠后仍应命中。
assert.deepEqual(
  locateLocalEdit(block7, {
    expectedText:
      '本次整治旨在聚焦群众反映强烈、矛盾突出的"三资"管理乱象，通过全面排查、精准整治，实现"底数清、权属明、管理规范、监督有力"的工作目标。力争通过为期半年的专项整治，使全市村级集体经济组织财务公开透明率达到100%，不规范合同清理整改率达到95%以上，有效防范廉政风险，堵塞管理漏洞，建立健全长效监管机制，显著提升乡村治理水平和群众满意度。',
    targetText: '财务公开透明率达到100%，不规范合同清理整改率达到95%以上',
  }),
  { ok: true, targetStart: block7.indexOf('财务公开透明率达到100%') }
);

// expectedText 只是段落中的一句话，不再要求等于整段。
const sentence = '对于租金拖欠超过6个月或拒不履行合同的，依法启动追缴或解除程序。';

assert.deepEqual(
  locateLocalEdit(block18, { expectedText: sentence, targetText: sentence }),
  { ok: true, targetStart: 105 }
);

assert.deepEqual(
  locateLocalEdit(block18, {
    expectedText: sentence,
    targetText: '租金拖欠超过6个月',
  }),
  { ok: true, targetStart: block18.indexOf('租金拖欠超过6个月') }
);

// 段落里出现两处同样的文字时，靠 expectedText 区分改哪一处。
const duplicated = '甲说达到100%，乙也说达到100%，收尾。';

assert.deepEqual(
  locateLocalEdit(duplicated, {
    expectedText: '甲说达到100%',
    targetText: '达到100%',
  }),
  { ok: true, targetStart: 2 }
);

assert.deepEqual(
  locateLocalEdit(duplicated, {
    expectedText: '乙也说达到100%',
    targetText: '达到100%',
  }),
  { ok: true, targetStart: 12 }
);

// 定位失败时要把段落真实内容回传，模型才能据此纠正参数。
const missing = locateLocalEdit(block18, {
  expectedText: '这段文字根本不在文档里',
  targetText: '不在',
});

assert.equal(missing.ok, false);
assert.ok(missing.message.includes(block18));

const outOfContext = locateLocalEdit(block18, {
  expectedText: sentence,
  targetText: '霸王合同',
});

assert.equal(outOfContext.ok, false);
assert.ok(outOfContext.message.includes(sentence));

// 写回正文时，挨着中文的 ASCII 引号还原成全角，英文和代码保持原样。
assert.equal(
  restoreCjkQuotes('严打"霸王合同"与"人情合同"'),
  '严打“霸王合同”与“人情合同”'
);
assert.equal(
  restoreCjkQuotes('use "utf-8" and don\'t panic'),
  'use "utf-8" and don\'t panic'
);
assert.equal(
  restoreCjkQuotes('平台名为"三资"，配置项 "mode" 不变'),
  '平台名为“三资”，配置项 "mode" 不变'
);

// 真正跑一遍编辑器事务：正文里加粗与普通文字混排，段落会被拆成多个 text 叶子。
const { createSlateEditor } = await jiti.import('platejs');
const { createLocalEditApplier } = await jiti.import(
  '../src/components/editor/local-edit/apply-local-edit.ts'
);

function createEditor() {
  return createSlateEditor({
    value: [
      {
        type: 'p',
        children: [
          { bold: true, text: '（四）合同清理方面：严打“霸王合同”与“人情合同”' },
          {
            text: '对现存的所有经济合同进行全面清理“回头看”。对于租金拖欠超过6个月或拒不履行合同的，依法启动追缴或解除程序。',
          },
        ],
      },
    ],
  });
}

// 跨叶子定位：目标在第二个叶子内部。
const editor = createEditor();

assert.deepEqual(
  createLocalEditApplier(editor)({
    path: [0],
    expectedText: '对于租金拖欠超过6个月或拒不履行合同的，依法启动追缴或解除程序。',
    targetText: '超过6个月',
    replacement: '超过3个月',
  }),
  { success: true }
);
assert.ok(editor.api.string([0]).includes('对于租金拖欠超过3个月或拒不履行合同的'));
assert.equal(editor.children[0].children[0].bold, true);
assert.equal(
  editor.children[0].children[0].text,
  '（四）合同清理方面：严打“霸王合同”与“人情合同”'
);

// 目标正好落在叶子边界上：替换文字应归属后一个叶子，不能被加粗吃掉。
const boundaryEditor = createEditor();

assert.deepEqual(
  createLocalEditApplier(boundaryEditor)({
    path: [0],
    expectedText: '对现存的所有经济合同进行全面清理',
    targetText: '对现存的所有经济合同',
    replacement: '对全部经济合同',
  }),
  { success: true }
);
assert.ok(boundaryEditor.api.string([0]).startsWith('（四）合同清理方面'));
assert.ok(boundaryEditor.api.string([0]).includes('对全部经济合同进行全面清理'));
assert.equal(
  boundaryEditor.children[0].children.find((leaf) =>
    leaf.text.includes('对全部经济合同')
  ).bold,
  undefined
);

// 模型给的 ASCII 引号写进正文时要变回全角。
const quoteEditor = createEditor();

assert.deepEqual(
  createLocalEditApplier(quoteEditor)({
    path: [0],
    expectedText: '依法启动追缴或解除程序。',
    targetText: '依法启动追缴或解除程序。',
    replacement: '依法启动"追缴"或"解除"程序。',
  }),
  { success: true }
);
assert.ok(quoteEditor.api.string([0]).endsWith('依法启动“追缴”或“解除”程序。'));

// 参数对不上时不能改动文档。
const untouchedEditor = createEditor();
const before = untouchedEditor.api.string([0]);
const rejected = createLocalEditApplier(untouchedEditor)({
  path: [0],
  expectedText: '文档里没有这句话',
  targetText: '没有',
  replacement: '有',
});

assert.equal(rejected.success, false);
assert.equal(untouchedEditor.api.string([0]), before);

console.log('local-edit 定位、标点与编辑器事务用例全部通过');
