import type { Descendant } from 'platejs';

import { DOCUMENT_TIME_ZONE } from '@/lib/current-date';

export type OfficialDocumentBodyBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string };

export type OfficialDocumentBody = {
  title: string;
  blocks: OfficialDocumentBodyBlock[];
};

export type OfficialDocumentValidationMessage = {
  code: string;
  message: string;
  blockIndex?: number;
};

export type OfficialDocumentValidationResult = {
  valid: boolean;
  document: OfficialDocumentBody | null;
  errors: OfficialDocumentValidationMessage[];
  warnings: OfficialDocumentValidationMessage[];
};

export type OfficialDocumentMetadataForm = {
  copyNumber: string;
  securityLevel: string;
  urgency: string;
  issuingAuthority: string;
  documentNumber: string;
  primaryRecipient: string;
  signingAuthority: string;
  documentDate: string;
  note: string;
  ccRecipients: string;
  printingAuthority: string;
  printingDate: string;
};

export type OfficialDocumentMetadata = OfficialDocumentMetadataForm & {
  documentDateText: string;
  printingDateText: string;
};

export type OfficialDocumentMetadataError = {
  field: keyof OfficialDocumentMetadataForm;
  message: string;
};

export type OfficialDocumentMetadataValidationResult =
  | { valid: true; data: OfficialDocumentMetadata; errors: [] }
  | { valid: false; data: null; errors: OfficialDocumentMetadataError[] };

const allowedBlockTypes = new Set(['h1', 'h2', 'p']);
const firstLevelHeadingPattern = /^[一二三四五六七八九十百零〇]+、\S/;

function normalizeBlockText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function getBlockText(
  node: Descendant,
  blockIndex: number,
  errors: OfficialDocumentValidationMessage[],
  warnings: OfficialDocumentValidationMessage[]
) {
  if (!('children' in node) || !Array.isArray(node.children)) {
    errors.push({
      code: 'invalid-block',
      blockIndex,
      message: `第 ${blockIndex + 1} 个内容块不是有效的块级节点。`,
    });
    return '';
  }

  let hasInlineStyle = false;
  let hasNestedElement = false;

  const text = (node.children as Descendant[])
    .map((child) => {
      if ('text' in child) {
        const attributes = Object.entries(child).filter(
          ([key, value]) => key !== 'text' && Boolean(value)
        );
        hasInlineStyle ||= attributes.length > 0;
        return String(child.text ?? '');
      }

      hasNestedElement = true;
      return '';
    })
    .join('');

  if (hasNestedElement) {
    errors.push({
      code: 'nested-inline-element',
      blockIndex,
      message: `第 ${blockIndex + 1} 个内容块包含链接、图片或其他嵌套元素，红头文件正文只支持纯文本。`,
    });
  }

  if (hasInlineStyle) {
    warnings.push({
      code: 'inline-style-normalized',
      blockIndex,
      message: `第 ${blockIndex + 1} 个内容块含有加粗、斜体等行内样式，导出时会按公文规范统一排版。`,
    });
  }

  return normalizeBlockText(text);
}

export function validateAndExtractOfficialDocumentBody(
  value: Descendant[]
): OfficialDocumentValidationResult {
  const errors: OfficialDocumentValidationMessage[] = [];
  const warnings: OfficialDocumentValidationMessage[] = [];
  const parsedBlocks: Array<{
    blockIndex: number;
    type: 'h1' | 'h2' | 'p';
    text: string;
  }> = [];
  let emptyParagraphCount = 0;

  value.forEach((node, blockIndex) => {
    if (!('children' in node) || typeof node.type !== 'string') {
      errors.push({
        code: 'invalid-top-level-node',
        blockIndex,
        message: `第 ${blockIndex + 1} 个内容块无法识别，请将其改为一级标题、二级标题或正文。`,
      });
      return;
    }

    if (!allowedBlockTypes.has(node.type)) {
      errors.push({
        code: 'unsupported-block-type',
        blockIndex,
        message: `第 ${blockIndex + 1} 个内容块是 ${node.type}，红头文件只支持 H1、H2 和普通段落。`,
      });
      return;
    }

    const type = node.type as 'h1' | 'h2' | 'p';
    const text = getBlockText(node, blockIndex, errors, warnings);

    if (!text) {
      if (type === 'p') {
        emptyParagraphCount += 1;
      } else {
        errors.push({
          code: 'empty-heading',
          blockIndex,
          message: `第 ${blockIndex + 1} 个标题为空，请填写标题文字。`,
        });
      }
      return;
    }

    parsedBlocks.push({ blockIndex, type, text });
  });

  if (emptyParagraphCount > 0) {
    warnings.push({
      code: 'empty-paragraph-ignored',
      message: `已忽略 ${emptyParagraphCount} 个空白段落。`,
    });
  }

  const titleBlocks = parsedBlocks.filter((block) => block.type === 'h1');

  if (titleBlocks.length === 0) {
    errors.push({
      code: 'missing-title',
      message: '正文缺少 H1 主标题。请将文档标题设置为唯一的 H1。',
    });
  } else if (titleBlocks.length > 1) {
    errors.push({
      code: 'multiple-titles',
      message: `检测到 ${titleBlocks.length} 个 H1，红头文件只能有一个主标题。`,
    });
  }

  if (parsedBlocks.length > 0 && parsedBlocks[0].type !== 'h1') {
    errors.push({
      code: 'title-not-first',
      blockIndex: parsedBlocks[0].blockIndex,
      message: 'H1 主标题必须是文档中的第一个非空内容块。',
    });
  }

  parsedBlocks
    .filter((block) => block.type === 'h2')
    .forEach((block) => {
      if (!firstLevelHeadingPattern.test(block.text)) {
        errors.push({
          code: 'invalid-section-heading',
          blockIndex: block.blockIndex,
          message: `第 ${block.blockIndex + 1} 个内容块的 H2 应以“一、”“二、”等中文一级序号开头。`,
        });
      }
    });

  const paragraphCount = parsedBlocks.filter(
    (block) => block.type === 'p'
  ).length;

  if (paragraphCount === 0) {
    errors.push({
      code: 'missing-body-paragraph',
      message: '正文至少需要一个普通段落。',
    });
  }

  const title = titleBlocks[0]?.text ?? '';
  const document =
    errors.length === 0
      ? {
          title,
          blocks: parsedBlocks
            .filter((block) => block.type !== 'h1')
            .map<OfficialDocumentBodyBlock>((block) =>
              block.type === 'h2'
                ? { kind: 'heading', text: block.text }
                : { kind: 'paragraph', text: block.text }
            ),
        }
      : null;

  return {
    valid: errors.length === 0,
    document,
    errors,
    warnings,
  };
}

function formatDateInput(dateInput: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}年${month}月${day}日`;
}

function trimTrailingPunctuation(value: string) {
  return value.trim().replace(/[：:；;，,。]+$/u, '');
}

export function createDefaultOfficialDocumentMetadataForm(
  now: Date = new Date()
): OfficialDocumentMetadataForm {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DOCUMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((item) => item.type === type)?.value ?? '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;

  return {
    copyNumber: '000001',
    securityLevel: '',
    urgency: '',
    issuingAuthority: '泉州市农业农村局',
    documentNumber: '',
    primaryRecipient: '各县（市、区）农业农村主管部门',
    signingAuthority: '泉州市农业农村局',
    documentDate: date,
    note: '',
    ccRecipients: '',
    printingAuthority: '泉州市农业农村局',
    printingDate: date,
  };
}

export function validateOfficialDocumentMetadata(
  form: OfficialDocumentMetadataForm
): OfficialDocumentMetadataValidationResult {
  const normalized: OfficialDocumentMetadataForm = {
    copyNumber: form.copyNumber.trim(),
    securityLevel: form.securityLevel.trim(),
    urgency: form.urgency.trim(),
    issuingAuthority: form.issuingAuthority.trim(),
    documentNumber: form.documentNumber.trim(),
    primaryRecipient: trimTrailingPunctuation(form.primaryRecipient),
    signingAuthority: form.signingAuthority.trim(),
    documentDate: form.documentDate.trim(),
    note: form.note.trim().replace(/^[（(]|[）)]$/gu, ''),
    ccRecipients: trimTrailingPunctuation(form.ccRecipients),
    printingAuthority: form.printingAuthority.trim(),
    printingDate: form.printingDate.trim(),
  };
  const errors: OfficialDocumentMetadataError[] = [];

  if (!normalized.issuingAuthority) {
    errors.push({ field: 'issuingAuthority', message: '请填写发文机关。' });
  }

  if (
    normalized.copyNumber &&
    !/^\d{6}$/.test(normalized.copyNumber)
  ) {
    errors.push({
      field: 'copyNumber',
      message: '份号应为 6 位阿拉伯数字，例如 000001。',
    });
  }

  const documentDateText = formatDateInput(normalized.documentDate);
  if (!documentDateText) {
    errors.push({
      field: 'documentDate',
      message: '请选择有效的成文日期。',
    });
  }

  const printingDateSource =
    normalized.printingDate || normalized.documentDate;
  const printingDateText = formatDateInput(printingDateSource);
  if (!printingDateText) {
    errors.push({
      field: 'printingDate',
      message: '请选择有效的印发日期。',
    });
  }

  if (errors.length > 0 || !documentDateText || !printingDateText) {
    return { valid: false, data: null, errors };
  }

  return {
    valid: true,
    data: {
      ...normalized,
      signingAuthority:
        normalized.signingAuthority || normalized.issuingAuthority,
      printingAuthority:
        normalized.printingAuthority || normalized.issuingAuthority,
      printingDate: printingDateSource,
      documentDateText,
      printingDateText,
    },
    errors: [],
  };
}
