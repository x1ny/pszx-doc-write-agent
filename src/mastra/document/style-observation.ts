import { z } from 'zod';

/**
 * 风格观察的数据契约、证据校验与跨篇定档。
 *
 * 这一层同样不经过模型。“几篇材料里出现过”是计数题，一旦交给模型，
 * 证据强度就退化成语感，稳定特征和一次性写法会被混为一谈。
 */

export const STYLE_DIMENSIONS = [
  '开篇与收束',
  '行文推进',
  '句式与语势',
  '遣词与表达',
  '数据与例证',
] as const;

export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export const EVIDENCE_BANDS = ['稳定特征', '较稳定', '近期渐强', '偶发'] as const;

export type EvidenceBand = (typeof EVIDENCE_BANDS)[number];

/** 单篇观察：只描述“看到了什么写法”，不判断是否稳定。 */
export const styleObservationSchema = z.object({
  dimension: z.enum(STYLE_DIMENSIONS),
  claim: z.string().trim().min(4).max(60).describe('一句话写法描述，不含具体政策、项目、年份、地名'),
  evidence: z
    .array(z.string().trim().min(2).max(40))
    .min(1)
    .max(3)
    .describe('原文片段，必须能在正文中原样检索到'),
  scope: z
    .enum(['跨文种通用', '本文种特有'])
    .describe('换成同一人写一份《通知》是否仍然成立'),
});

export type StyleObservation = z.infer<typeof styleObservationSchema>;

export const styleObservationResultSchema = z.object({
  observations: z.array(styleObservationSchema).max(10),
});

/** 汇总阶段由模型完成的语义合并结果，档位不由模型决定。 */
export const mergedFeatureSchema = z.object({
  dimension: z.enum(STYLE_DIMENSIONS),
  claim: z.string().trim().min(4).max(40).describe('风格结论，用作小标题后半句'),
  detail: z.string().trim().min(10).max(200).describe('说明，需带原文证据'),
  supportingDocumentIds: z.array(z.string().trim().min(1)).min(1),
  constraint: z.string().trim().min(6).max(80).describe('给写作模型的祈使句，无修饰'),
});

export type MergedFeature = z.infer<typeof mergedFeatureSchema>;

export const styleSynthesisResultSchema = z.object({
  features: z.array(mergedFeatureSchema).max(12),
  overview: z.string().trim().min(30).max(200).describe('风格总述，约 80 字'),
  maxim: z.string().trim().min(6).max(40).describe('风格要诀，一句话'),
});

export type StyleSynthesisResult = z.infer<typeof styleSynthesisResultSchema>;

export type StyleDocumentRef = {
  documentId: string;
  title: string;
  /** 材料年份或日期，用于判断“近期” */
  date: string;
  charCount: number;
};

export type BandedFeature = MergedFeature & {
  band: EvidenceBand | null;
  supportingCount: number;
};

export type StyleProfileData = {
  subjectName: string;
  documents: StyleDocumentRef[];
  /** 进入报告正文的特征，已按维度排序 */
  features: BandedFeature[];
  /** 证据不足，只进附注的特征 */
  incidental: BandedFeature[];
  overview: string;
  maxim: string;
};

/**
 * 宽松匹配：模型回抄证据时经常改动标点或引号样式，
 * 只比较汉字、字母和数字，避免把真证据误杀。
 */
function normalizeForLookup(text: string) {
  return text.replace(/[^一-龥a-zA-Z0-9]/g, '');
}

/**
 * 丢弃无法在原文中检索到的观察。
 *
 * 这是防幻觉最有效的一道闸：模型可以编出一句风格判断，
 * 但编不出一段能在正文里原样找到的证据。
 */
export function verifyObservations(
  observations: StyleObservation[],
  article: string
): { kept: StyleObservation[]; dropped: StyleObservation[] } {
  const haystack = normalizeForLookup(article);
  const kept: StyleObservation[] = [];
  const dropped: StyleObservation[] = [];

  for (const observation of observations) {
    const verified = observation.evidence.filter((item) => {
      const needle = normalizeForLookup(item);
      return needle.length >= 2 && haystack.includes(needle);
    });

    if (verified.length) {
      kept.push({ ...observation, evidence: verified });
    } else {
      dropped.push(observation);
    }
  }

  return { kept, dropped };
}

/**
 * detail 中较长的引号片段必须来自已验证证据或实测指标，不能是模型自己拼的。
 *
 * 短片段（如“福农优品”“确保”）是凝练语和词汇，不是引文，不参与校验，
 * 阈值定在 8 字以上，正好把“看似原文引用”的长句挑出来。
 */
const LONG_QUOTE = /[“"]([^”"\n]{8,})[”"]/g;

export function collectEvidencePool(
  bundles: { metricsText: string; observations: StyleObservation[] }[]
) {
  return bundles
    .flatMap((bundle) => [
      bundle.metricsText,
      ...bundle.observations.flatMap((observation) => observation.evidence),
    ])
    .join('\n');
}

/** 返回 detail 中无法在证据池里找到出处的引文。 */
export function findUnsupportedQuotes(features: MergedFeature[], evidencePool: string) {
  const haystack = normalizeForLookup(evidencePool);
  const unsupported: string[] = [];

  for (const feature of features) {
    for (const match of feature.detail.matchAll(LONG_QUOTE)) {
      const quote = match[1];
      if (!haystack.includes(normalizeForLookup(quote))) unsupported.push(quote);
    }
  }

  return [...new Set(unsupported)];
}

/**
 * 把查不到出处的引文去掉引号，降级成普通描述，而不是回炉重新生成整份汇总。
 *
 * 这类改动多是模型顺手给原句添了一两个字（“连续七年”），语义仍然成立，
 * 只是不再够格当“原文引用”；为此多跑一轮模型调用不划算，代码摘掉引号即可。
 */
export function sanitizeUnsupportedQuotes(
  features: MergedFeature[],
  evidencePool: string
): MergedFeature[] {
  const haystack = normalizeForLookup(evidencePool);

  return features.map((feature) => ({
    ...feature,
    detail: feature.detail.replace(LONG_QUOTE, (full, quote: string) =>
      haystack.includes(normalizeForLookup(quote)) ? full : quote
    ),
  }));
}

/** 只保留换个文种仍然成立的观察，其余属于文种模板，不进个人画像。 */
export function keepTransferableObservations(observations: StyleObservation[]) {
  return observations.filter((observation) => observation.scope === '跨文种通用');
}

/**
 * 根据支持篇数定档。返回 null 表示单篇模式，不做稳定性判断。
 *
 * 定档规则写死在代码里，模型给出的档位一律忽略——
 * 否则“稳定特征”会变成模型的修辞而不是统计结论。
 */
export function resolveBand(
  supportingDocumentIds: string[],
  documentsInChronologicalOrder: StyleDocumentRef[]
): EvidenceBand | null {
  const total = documentsInChronologicalOrder.length;
  if (total <= 1) return null;

  const validIds = new Set(documentsInChronologicalOrder.map((item) => item.documentId));
  const supporting = new Set(supportingDocumentIds.filter((id) => validIds.has(id)));
  const count = supporting.size;

  if (count === 0) return '偶发';
  if (count === total) return '稳定特征';
  if (count / total >= 0.6) return '较稳定';

  if (count === 2) {
    const lastTwo = documentsInChronologicalOrder.slice(-2);
    if (lastTwo.every((item) => supporting.has(item.documentId))) return '近期渐强';
  }

  return '偶发';
}

function sortByDate(documents: StyleDocumentRef[]) {
  return [...documents].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * 把模型的合并结果定档、分流并按维度排序。
 *
 * 证据不足的特征不会被删掉，而是转入附注并显式声明“不计入稳定风格”——
 * 显式排除比默默丢弃更能说明分析有判断力。
 */
export function bandStyleFeatures({
  subjectName,
  documents,
  synthesis,
}: {
  subjectName: string;
  documents: StyleDocumentRef[];
  synthesis: StyleSynthesisResult;
}): StyleProfileData {
  const chronological = sortByDate(documents);
  const dimensionOrder = new Map<StyleDimension, number>(
    STYLE_DIMENSIONS.map((dimension, index) => [dimension, index])
  );

  const banded: BandedFeature[] = synthesis.features.map((feature) => {
    const validIds = new Set(chronological.map((item) => item.documentId));
    const supporting = [...new Set(feature.supportingDocumentIds)].filter((id) =>
      validIds.has(id)
    );
    return {
      ...feature,
      supportingDocumentIds: supporting,
      supportingCount: supporting.length,
      band: resolveBand(supporting, chronological),
    };
  });

  const isReportable = (feature: BandedFeature) =>
    feature.band === null || feature.band !== '偶发';

  const byDimension = (left: BandedFeature, right: BandedFeature) =>
    (dimensionOrder.get(left.dimension) ?? 0) - (dimensionOrder.get(right.dimension) ?? 0);

  return {
    subjectName,
    documents: chronological,
    features: banded.filter(isReportable).sort(byDimension),
    incidental: banded.filter((feature) => !isReportable(feature)).sort(byDimension),
    overview: synthesis.overview,
    maxim: synthesis.maxim,
  };
}
