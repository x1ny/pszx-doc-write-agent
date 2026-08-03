import {
  STYLE_DIMENSIONS,
  type BandedFeature,
  type StyleProfileData,
} from './style-observation';

/**
 * 由代码把结构化画像渲染成最终文本。
 *
 * 报告格式是固定的，交给模型渲染只会带来标题走样、档位标签漏写、
 * 维度顺序漂移这类问题。模型负责措辞，排版归代码。
 */

const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function toChineseNumeral(index: number) {
  return CHINESE_NUMERALS[index] ?? String(index + 1);
}

function formatScale(documentCount: number, charCount: number) {
  const inTenThousands = charCount / 10000;
  const size =
    inTenThousands >= 1 ? `约 ${inTenThousands.toFixed(1)} 万字` : `约 ${charCount} 字`;
  return `${documentCount} 篇，${size}`;
}

function formatBand(feature: BandedFeature) {
  return feature.band ? `　\`${feature.band}\`` : '';
}

/** 材料 date 多为“2023”这类纯年份，补上单位后才像正式报告的抬头。 */
function formatDateRange(dates: string[]) {
  if (!dates.length) return '未标注';
  const first = dates[0];
  const last = dates[dates.length - 1];
  const isYear = /^\d{4}$/.test(first) && /^\d{4}$/.test(last);
  if (first === last) return isYear ? `${first} 年` : first;
  return isYear ? `${first}—${last} 年` : `${first}—${last}`;
}

function stripTrailingPeriod(text: string) {
  return text.replace(/[。．.]+$/, '');
}

function groupByDimension(features: BandedFeature[]) {
  return STYLE_DIMENSIONS.map((dimension) => ({
    dimension,
    items: features.filter((feature) => feature.dimension === dimension),
  })).filter((group) => group.items.length > 0);
}

/** 用户可见的分析报告。抬头信息区是专业感的主要来源，不要省。 */
export function renderStyleReport(data: StyleProfileData) {
  const { documents } = data;
  const isSingle = documents.length <= 1;
  const totalChars = documents.reduce((sum, item) => sum + item.charCount, 0);
  const dates = documents.map((item) => item.date).filter(Boolean);

  const lines: string[] = [
    '# 写作风格分析报告',
    '',
    `**分析对象**　${data.subjectName}`,
    `**材料范围**　${isSingle ? documents[0]?.title || '单篇材料' : formatDateRange(dates)}`,
    `**材料规模**　${formatScale(documents.length, totalChars)}`,
  ];

  if (isSingle) {
    lines.push('**分析说明**　单篇分析，未做跨篇稳定性验证，结论仅反映当前材料');
  }

  lines.push('', '---', '');

  groupByDimension(data.features).forEach((group, index) => {
    const [primary, ...rest] = group.items;
    lines.push(
      `**${toChineseNumeral(index)}、${group.dimension}：${primary.claim}**${formatBand(primary)}`,
      primary.detail
    );
    for (const extra of rest) {
      lines.push(`${extra.claim}——${extra.detail}${formatBand(extra)}`);
    }
    lines.push('');
  });

  lines.push('---', '', '**风格总述**', data.overview, '', `**风格要诀**　${data.maxim}`);

  if (data.incidental.length) {
    const notes = data.incidental
      .map(
        (feature) =>
          `${stripTrailingPeriod(feature.claim)}（${stripTrailingPeriod(feature.detail)}）`
      )
      .join('；');
    lines.push('', '---', '', `*附：偶发特征（不计入稳定风格）——${notes}。*`);
  }

  return lines.join('\n').trim();
}

/**
 * 写作模型消费的风格约束。
 *
 * 与报告同源但另行渲染：报告要庄重可读，约束要短促可执行，
 * 一份文本同时干这两件事的结果是给人看嫌干、给模型用嫌啰嗦。
 */
export function renderStyleConstraints(data: StyleProfileData) {
  const constraints = data.features.map((feature) => `- ${feature.constraint}`);

  return [
    `以下是${data.subjectName}的写作风格约束，撰写时须逐条遵循：`,
    '',
    ...constraints,
    '',
    `总纲：${data.maxim}`,
  ]
    .join('\n')
    .trim();
}
