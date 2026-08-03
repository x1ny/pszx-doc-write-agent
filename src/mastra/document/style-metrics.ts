/**
 * 公文文本的确定性指标测量。
 *
 * 这一层不经过模型。句长、密度、频次都是算术题，交给模型既算不准又会顺口编，
 * 实测中就出现过把平均句长 50 字的材料判成“短句为主”的情况。
 * 这里测出来的事实会原样写进风格观察提示词，模型只能在事实之上做解释。
 */

export type MetricEntry = { text: string; count: number };

export type StyleMetrics = {
  charCount: number;
  paragraphCount: number;
  sentence: {
    count: number;
    meanLength: number;
    medianLength: number;
    /** 超过 40 字的长句占比，0—1 */
    longRatio: number;
    /** 不足 15 字的短句占比，0—1 */
    shortRatio: number;
  };
  /** 指令性表达（要／必须／务必／应当／确保）每百字出现次数 */
  directivePer100: number;
  /** 强禁止表达（严禁／不得／绝不／不允许／杜绝）出现次数 */
  strongProhibitionCount: number;
  /** 一般否定表达（不能／不搞／防止／避免／严防）出现次数 */
  mildProhibitionCount: number;
  /** 阿拉伯数字每百字出现次数 */
  numberPer100: number;
  /** 位次表达（全国第三／全省首位／全国前列）出现次数与样例 */
  rankExpressions: MetricEntry[];
  /** 引号凝练语每千字出现次数 */
  quotedPhrasePer1000: number;
  quotedPhrases: MetricEntry[];
  /** “两条底线”“五项改革”式数字概括短语 */
  numericSummaries: MetricEntry[];
  /** 区分度较高的强动作动词 */
  markedVerbs: MetricEntry[];
  /** 公文通用动词，区分度低，仅作对照 */
  commonVerbs: MetricEntry[];
  /** 顿号每百字出现次数，反映并列铺陈密度 */
  enumerationCommaPer100: number;
  /** 段首领句形式分布 */
  paragraphLeads: MetricEntry[];
  /** 人称与称谓分布 */
  addressTerms: MetricEntry[];
  /** 首段原文（截断） */
  opening: string;
  /** 末段原文（截断） */
  closing: string;
};

const LONG_SENTENCE_THRESHOLD = 40;
const SHORT_SENTENCE_THRESHOLD = 15;
/** 首末段直接支撑“开篇与收束”维度，截得太短会把收尾套语切掉。 */
const EXCERPT_LIMIT = 320;

/** “要”的常见非指令性组词，计数前先剔除，否则“重要/主要/需要”会把密度抬高一倍。 */
const DIRECTIVE_NOISE =
  /(重要|主要|需要|只要|若要|首要|摘要|纪要|要求|要素|要点|要害|要件|要义|概要|简要|扼要|必要|次要|不要|想要)/g;

const STRONG_PROHIBITION = /严禁|不得|绝不|不允许|杜绝|严控|严查/g;
const MILD_PROHIBITION = /不能|不搞|防止|避免|严防|不再|不宜/g;

const RANK_EXPRESSION =
  /(?:全国|全省|大陆|全市)(?:第[一二三四五六七八九十百\d]+|首位|前列|前茅|领先|靠后|之首)/g;

const QUOTED_PHRASE = /[“"]([^”"\n]{2,12})[”"]/g;

const NUMERIC_SUMMARY =
  /[一两二三四五六七八九十]{1,2}[个条项大道套方面]{1}[一-龥]{2,4}/g;

/**
 * “二十大精神”“八项规定精神”等专有名词会被数字概括短语的正则命中，
 * 它们是固定提法而不是个人概括习惯，必须剔除，否则每篇都会榜上有名。
 */
const NUMERIC_SUMMARY_DENYLIST =
  /(二十大|二十届|十九大|十八大|十七大|八项规定|三中全会|[和与及、])/;

/**
 * 强动作动词：在同类公文中出现频率差异明显，能体现个人用词偏好。
 * 通用动词单列，因为“推进/加强”几乎每篇公文都有，写进画像等于没写。
 */
const MARKED_VERBS = [
  '压实', '守牢', '兜牢', '扛起', '倒排', '盘活', '化解', '抓实', '做实',
  '落细', '攻坚', '破解', '严把', '摸清', '清仓', '锻造', '激活', '释放',
  '拧紧', '压茬', '闭环', '见效',
];

const COMMON_VERBS = [
  '推进', '推动', '加强', '强化', '深化', '优化', '完善', '健全', '提升',
  '巩固', '拓展', '培育', '打造', '统筹', '聚焦', '加快', '促进', '保障',
];

const ADDRESS_TERMS = ['我们', '各地', '大家', '同志们', '我省', '全省', '各级'];

const PARAGRAPH_LEAD_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: '一要／二要式', pattern: /^[一二三四五六七八九十]要/ },
  { label: '一是／二是式', pattern: /^[一二三四五六七八九十]是/ },
  { label: '（一）关于式', pattern: /^（[一二三四五六七八九十]+）\s*关于/ },
  { label: '（一）式', pattern: /^（[一二三四五六七八九十]+）/ },
  { label: '一、式', pattern: /^[一二三四五六七八九十]+、/ },
  { label: '要+动词直起', pattern: /^要[一-龥]/ },
  { label: '第一／首先式', pattern: /^(第[一二三四五六七八九十]|首先|其次|最后)/ },
];

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

/** 按出现次数降序取前 N 项，用于把长尾裁掉只留可读的高频项。 */
function topEntries(counts: Map<string, number>, limit: number): MetricEntry[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function collectPattern(
  text: string,
  pattern: RegExp,
  limit: number,
  exclude?: RegExp
) {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? match[0]).trim();
    if (!value || exclude?.test(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return topEntries(counts, limit);
}

function collectWordList(text: string, words: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const word of words) {
    const count = text.split(word).length - 1;
    if (count > 0) counts.set(word, count);
  }
  return topEntries(counts, limit);
}

/** 去掉 markdown 标记，避免 `#`、`**` 干扰段首形式和字数统计。 */
function normalizeArticle(article: string) {
  return article
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|`{1,3}/g, '')
    .trim();
}

function splitParagraphs(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitSentences(text: string) {
  return text
    .split(/[。！？；\n]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 3);
}

function countDirectives(text: string) {
  const withoutNoise = text.replace(DIRECTIVE_NOISE, '');
  return (
    countMatches(withoutNoise, /要/g) + countMatches(text, /必须|务必|应当|确保/g)
  );
}

function excerpt(paragraph: string | undefined) {
  if (!paragraph) return '';
  return paragraph.length > EXCERPT_LIMIT
    ? `${paragraph.slice(0, EXCERPT_LIMIT)}……`
    : paragraph;
}

/**
 * 计算单篇材料的风格指标。
 *
 * 只做测量，不做判断——“长句占比 56%”是事实，“行文滞重”是解释，后者归模型。
 */
export function measureStyleMetrics(article: string): StyleMetrics {
  const text = normalizeArticle(article);
  const charCount = text.replace(/\s/g, '').length || 1;
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);
  const lengths = sentences.map((sentence) => sentence.length);
  const sentenceCount = lengths.length || 1;

  const leadCounts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    for (const { label, pattern } of PARAGRAPH_LEAD_PATTERNS) {
      if (pattern.test(paragraph)) {
        leadCounts.set(label, (leadCounts.get(label) ?? 0) + 1);
        break;
      }
    }
  }

  const quotedPhrases = collectPattern(text, QUOTED_PHRASE, 20);
  const quotedTotal = countMatches(text, QUOTED_PHRASE);

  return {
    charCount,
    paragraphCount: paragraphs.length,
    sentence: {
      count: lengths.length,
      meanLength: round(lengths.reduce((sum, value) => sum + value, 0) / sentenceCount),
      medianLength: median(lengths),
      longRatio: round(
        lengths.filter((value) => value > LONG_SENTENCE_THRESHOLD).length / sentenceCount,
        2
      ),
      shortRatio: round(
        lengths.filter((value) => value < SHORT_SENTENCE_THRESHOLD).length / sentenceCount,
        2
      ),
    },
    directivePer100: round((100 * countDirectives(text)) / charCount),
    strongProhibitionCount: countMatches(text, STRONG_PROHIBITION),
    mildProhibitionCount: countMatches(text, MILD_PROHIBITION),
    numberPer100: round((100 * countMatches(text, /\d+(?:\.\d+)?/g)) / charCount),
    rankExpressions: collectPattern(text, RANK_EXPRESSION, 8),
    quotedPhrasePer1000: round((1000 * quotedTotal) / charCount),
    quotedPhrases,
    numericSummaries: collectPattern(
      text,
      NUMERIC_SUMMARY,
      10,
      NUMERIC_SUMMARY_DENYLIST
    ),
    markedVerbs: collectWordList(text, MARKED_VERBS, 12),
    commonVerbs: collectWordList(text, COMMON_VERBS, 8),
    enumerationCommaPer100: round((100 * countMatches(text, /、/g)) / charCount),
    paragraphLeads: topEntries(leadCounts, 6),
    addressTerms: collectWordList(text, ADDRESS_TERMS, 7),
    opening: excerpt(paragraphs.find((paragraph) => paragraph.length > 40)),
    closing: excerpt(paragraphs[paragraphs.length - 1]),
  };
}

/** 送进模型的正文采样上限。指标是在全文上算的，模型只需要看到足够的样本。 */
const SAMPLE_LIMIT = 6000;

/**
 * 从长文中取头、中、尾三段样本。
 *
 * 一篇 1.6 万字的报告全量送进模型，光预填就要十几秒，
 * 而风格是重复出现的——三段样本足以看出同样的写法，首尾段另有实测指标兜底。
 */
export function sampleArticle(article: string, limit = SAMPLE_LIMIT) {
  const text = article.trim();
  if (text.length <= limit) return text;

  const head = Math.round(limit * 0.45);
  const middle = Math.round(limit * 0.3);
  const tail = limit - head - middle;
  const middleStart = Math.floor((text.length - middle) / 2);

  return [
    text.slice(0, head),
    '……（中略）……',
    text.slice(middleStart, middleStart + middle),
    '……（中略）……',
    text.slice(text.length - tail),
  ].join('\n');
}

function formatEntries(entries: MetricEntry[]) {
  if (!entries.length) return '无';
  return entries.map((entry) => `${entry.text}(${entry.count})`).join('、');
}

/**
 * 把指标渲染成写进提示词的事实清单。
 *
 * 刻意只给数字不给结论，比如给“长句占比 56%”而不是“以长句为主”，
 * 避免提示词先替模型下了判断。
 */
export function formatStyleMetrics(metrics: StyleMetrics) {
  const { sentence } = metrics;

  return [
    '【实测指标（由程序统计，不得与之矛盾）】',
    `全文字数：${metrics.charCount}，段落数：${metrics.paragraphCount}`,
    `句子数：${sentence.count}，平均句长：${sentence.meanLength} 字，中位句长：${sentence.medianLength} 字`,
    `超过 40 字的长句占比：${Math.round(sentence.longRatio * 100)}%，不足 15 字的短句占比：${Math.round(sentence.shortRatio * 100)}%`,
    `指令性表达（要／必须／务必／应当／确保）密度：每百字 ${metrics.directivePer100} 次`,
    `强禁止表达（严禁／不得／绝不／不允许）：${metrics.strongProhibitionCount} 次；一般否定表达：${metrics.mildProhibitionCount} 次`,
    `阿拉伯数字密度：每百字 ${metrics.numberPer100} 个`,
    `位次表达：${formatEntries(metrics.rankExpressions)}`,
    `引号凝练语密度：每千字 ${metrics.quotedPhrasePer1000} 处；高频项：${formatEntries(metrics.quotedPhrases)}`,
    `数字概括短语：${formatEntries(metrics.numericSummaries)}`,
    `强动作动词：${formatEntries(metrics.markedVerbs)}`,
    `公文通用动词（区分度低，仅作对照）：${formatEntries(metrics.commonVerbs)}`,
    `顿号密度：每百字 ${metrics.enumerationCommaPer100} 个`,
    `段首领句形式：${formatEntries(metrics.paragraphLeads)}`,
    `人称与称谓：${formatEntries(metrics.addressTerms)}`,
    '',
    `【首段原文】\n${metrics.opening || '（无）'}`,
    '',
    `【末段原文】\n${metrics.closing || '（无）'}`,
  ].join('\n');
}
