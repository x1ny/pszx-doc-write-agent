import {
  AlignmentType,
  BorderStyle,
  Document,
  DocumentGridType,
  Footer,
  HeightRule,
  LineRuleType,
  OverlapType,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  RelativeHorizontalPosition,
  RelativeVerticalPosition,
  Table,
  TableAnchorType,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
  type IBorderOptions,
  type IFontAttributesProperties,
} from 'docx';

import type {
  OfficialDocumentBody,
  OfficialDocumentMetadata,
} from '@/lib/official-document';

const RED = 'FF0000';
const BLACK = '000000';
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PAGE_MARGIN_TOP_MM = 37;
const PAGE_MARGIN_RIGHT_MM = 26;
const PAGE_MARGIN_BOTTOM_MM = 35;
const PAGE_MARGIN_LEFT_MM = 28;
const CONTENT_WIDTH_MM = 156;

const FONT_SMALL_MARK = '方正小标宋简体';
const FONT_FANGSONG = '仿宋_GB2312';
const FONT_HEITI = '黑体';
const FONT_SONG = '宋体';

const BODY_FONT_PT = 16;
const BODY_LINE_PT = 28.8;
const TITLE_FONT_PT = 22;
const VERSION_FONT_PT = 14;

function mm(value: number) {
  return Math.round(convertMillimetersToTwip(value));
}

function pt(value: number) {
  return Math.round(value * 20);
}

function halfPoints(value: number) {
  return Math.round(value * 2);
}

function font(name: string): IFontAttributesProperties {
  return {
    ascii: name,
    cs: name,
    eastAsia: name,
    hAnsi: name,
    hint: 'eastAsia',
  };
}

function run(
  text: string,
  options: {
    bold?: boolean;
    color?: string;
    fontName?: string;
    sizePt?: number;
  } = {}
) {
  return new TextRun({
    text,
    bold: options.bold,
    color: options.color ?? BLACK,
    font: font(options.fontName ?? FONT_FANGSONG),
    size: halfPoints(options.sizePt ?? BODY_FONT_PT),
    sizeComplexScript: halfPoints(options.sizePt ?? BODY_FONT_PT),
    language: { eastAsia: 'zh-CN', value: 'zh-CN' },
  });
}

function getIssuingAuthorityFontSize(issuingAuthority: string) {
  const widthUnits = Array.from(issuingAuthority).reduce(
    (total, character) =>
      total + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1),
    0
  );

  return Math.max(30, Math.min(54, Math.floor(430 / Math.max(widthUnits, 1))));
}

function createPageNumberFooter(alignment: 'left' | 'right') {
  const sideIndent = mm(7);
  return new Footer({
    children: [
      new Paragraph({
        alignment:
          alignment === 'left' ? AlignmentType.LEFT : AlignmentType.RIGHT,
        indent:
          alignment === 'left'
            ? { left: sideIndent }
            : { right: sideIndent },
        spacing: { after: 0, before: 0, line: pt(18), lineRule: LineRuleType.EXACT },
        children: [
          run('— ', { fontName: FONT_SONG, sizePt: VERSION_FONT_PT }),
          new TextRun({
            children: [PageNumber.CURRENT],
            color: BLACK,
            font: font(FONT_SONG),
            size: halfPoints(VERSION_FONT_PT),
          }),
          run(' —', { fontName: FONT_SONG, sizePt: VERSION_FONT_PT }),
        ],
      }),
    ],
  });
}

function createHeaderMetadataParagraph(metadata: OfficialDocumentMetadata) {
  const metadataLines = [
    metadata.copyNumber,
    metadata.securityLevel,
    metadata.urgency,
  ].filter(Boolean);
  const renderedLines = metadataLines.length > 0 ? metadataLines : [''];
  const consumedHeight = pt(BODY_LINE_PT * renderedLines.length);
  const targetAuthorityOffset = mm(35);

  return new Paragraph({
    spacing: {
      after: Math.max(0, targetAuthorityOffset - consumedHeight),
      before: 0,
      line: pt(BODY_LINE_PT),
      lineRule: LineRuleType.EXACT,
    },
    children: renderedLines.map(
      (line, index) =>
        new TextRun({
          text: line,
          break: index === 0 ? undefined : 1,
          color: BLACK,
          font: font(FONT_FANGSONG),
          size: halfPoints(BODY_FONT_PT),
        })
    ),
  });
}

function createRedHeader(metadata: OfficialDocumentMetadata) {
  const authorityFontSize = getIssuingAuthorityFontSize(
    metadata.issuingAuthority
  );
  const paragraphs: Paragraph[] = [
    createHeaderMetadataParagraph(metadata),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: {
        after: 0,
        before: 0,
        line: pt(authorityFontSize + 4),
        lineRule: LineRuleType.EXACT,
      },
      children: [
        run(metadata.issuingAuthority, {
          bold: true,
          color: RED,
          fontName: FONT_SMALL_MARK,
          sizePt: authorityFontSize,
        }),
      ],
    }),
  ];

  if (metadata.documentNumber) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: {
          after: 0,
          before: mm(8),
          line: pt(BODY_LINE_PT),
          lineRule: LineRuleType.EXACT,
        },
        children: [run(metadata.documentNumber)],
      })
    );
  }

  paragraphs.push(
    new Paragraph({
      border: {
        bottom: {
          color: RED,
          size: 18,
          space: 0,
          style: BorderStyle.SINGLE,
        },
      },
      keepNext: true,
      spacing: {
        after: mm(17),
        before: metadata.documentNumber ? mm(4) : mm(24),
        line: pt(1),
        lineRule: LineRuleType.EXACT,
      },
      children: [run('', { color: RED, sizePt: 1 })],
    })
  );

  return paragraphs;
}

function createTitle(title: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepLines: true,
    keepNext: true,
    spacing: {
      after: mm(8),
      before: 0,
      line: pt(35),
      lineRule: LineRuleType.EXACT,
    },
    children: [
      run(title, {
        bold: true,
        fontName: FONT_SMALL_MARK,
        sizePt: TITLE_FONT_PT,
      }),
    ],
  });
}

function createPrimaryRecipient(primaryRecipient: string) {
  if (!primaryRecipient) {
    return [];
  }

  return [
    new Paragraph({
      keepNext: true,
      spacing: {
        after: 0,
        before: 0,
        line: pt(BODY_LINE_PT),
        lineRule: LineRuleType.EXACT,
      },
      children: [run(`${primaryRecipient}：`)],
    }),
  ];
}

function createBodyParagraphs(body: OfficialDocumentBody) {
  return body.blocks.map(
    (block) =>
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        autoSpaceEastAsianText: false,
        indent: { firstLineChars: 200 },
        keepLines: true,
        keepNext: block.kind === 'heading',
        spacing: {
          after: 0,
          before: 0,
          line: pt(BODY_LINE_PT),
          lineRule: LineRuleType.EXACT,
        },
        widowControl: true,
        children: [
          run(block.text, {
            bold: block.kind === 'heading',
            fontName:
              block.kind === 'heading' ? FONT_HEITI : FONT_FANGSONG,
          }),
        ],
      })
  );
}

function createSignature(metadata: OfficialDocumentMetadata) {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      keepNext: true,
      spacing: {
        after: 0,
        before: 0,
        line: pt(BODY_LINE_PT),
        lineRule: LineRuleType.EXACT,
      },
      children: [run(metadata.signingAuthority)],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: {
        after: 0,
        before: 0,
        line: pt(BODY_LINE_PT),
        lineRule: LineRuleType.EXACT,
      },
      children: [run(metadata.documentDateText)],
    }),
  ];

  if (metadata.note) {
    paragraphs.push(
      new Paragraph({
        indent: { firstLineChars: 200 },
        spacing: {
          after: 0,
          before: 0,
          line: pt(BODY_LINE_PT),
          lineRule: LineRuleType.EXACT,
        },
        children: [run(`（${metadata.note}）`)],
      })
    );
  }

  return paragraphs;
}

const noBorder: IBorderOptions = {
  color: BLACK,
  size: 0,
  space: 0,
  style: BorderStyle.NONE,
};

const heavyBorder: IBorderOptions = {
  color: BLACK,
  size: 8,
  space: 0,
  style: BorderStyle.SINGLE,
};

const thinBorder: IBorderOptions = {
  color: BLACK,
  size: 6,
  space: 0,
  style: BorderStyle.SINGLE,
};

function createVersionParagraph(
  text: string,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType] =
    AlignmentType.LEFT
) {
  return new Paragraph({
    alignment,
    spacing: {
      after: 0,
      before: 0,
      line: pt(20),
      lineRule: LineRuleType.EXACT,
    },
    children: [run(text, { fontName: FONT_FANGSONG, sizePt: VERSION_FONT_PT })],
  });
}

function createVersionRecord(metadata: OfficialDocumentMetadata) {
  const contentWidth = mm(CONTENT_WIDTH_MM);
  const leftWidth = Math.round(contentWidth * 0.67);
  const rightWidth = contentWidth - leftWidth;
  const cellMargins = {
    bottom: 0,
    left: pt(VERSION_FONT_PT),
    marginUnitType: WidthType.DXA,
    right: pt(VERSION_FONT_PT),
    top: 0,
  };

  return new Table({
    alignment: AlignmentType.CENTER,
    borders: {
      bottom: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
      left: noBorder,
      right: noBorder,
      top: noBorder,
    },
    columnWidths: [leftWidth, rightWidth],
    float: {
      bottomFromText: 0,
      horizontalAnchor: TableAnchorType.MARGIN,
      leftFromText: 0,
      overlap: OverlapType.NEVER,
      relativeHorizontalPosition: RelativeHorizontalPosition.CENTER,
      relativeVerticalPosition: RelativeVerticalPosition.BOTTOM,
      rightFromText: 0,
      topFromText: mm(3),
      verticalAnchor: TableAnchorType.MARGIN,
    },
    layout: TableLayoutType.FIXED,
    width: { size: contentWidth, type: WidthType.DXA },
    rows: [
      new TableRow({
        cantSplit: true,
        height: { rule: HeightRule.ATLEAST, value: mm(7) },
        children: [
          new TableCell({
            borders: {
              bottom: thinBorder,
              left: noBorder,
              right: noBorder,
              top: heavyBorder,
            },
            columnSpan: 2,
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            width: { size: contentWidth, type: WidthType.DXA },
            children: [
              createVersionParagraph(
                `抄送：${metadata.ccRecipients}${
                  metadata.ccRecipients ? '。' : ''
                }`
              ),
            ],
          }),
        ],
      }),
      new TableRow({
        cantSplit: true,
        height: { rule: HeightRule.ATLEAST, value: mm(7) },
        children: [
          new TableCell({
            borders: {
              bottom: heavyBorder,
              left: noBorder,
              right: noBorder,
              top: noBorder,
            },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            width: { size: leftWidth, type: WidthType.DXA },
            children: [
              createVersionParagraph(
                `印发机关：${metadata.printingAuthority}`
              ),
            ],
          }),
          new TableCell({
            borders: {
              bottom: heavyBorder,
              left: noBorder,
              right: noBorder,
              top: noBorder,
            },
            margins: cellMargins,
            verticalAlign: VerticalAlign.CENTER,
            width: { size: rightWidth, type: WidthType.DXA },
            children: [
              createVersionParagraph(
                `${metadata.printingDateText}印发`,
                AlignmentType.RIGHT
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function createOfficialDocumentDocx(
  body: OfficialDocumentBody,
  metadata: OfficialDocumentMetadata
) {
  const pageNumberRight = createPageNumberFooter('right');
  const document = new Document({
    creator: metadata.issuingAuthority,
    description: '按照 GB/T 9704-2012 版式生成的党政机关公文',
    evenAndOddHeaderAndFooters: true,
    lastModifiedBy: metadata.issuingAuthority,
    title: body.title,
    sections: [
      {
        properties: {
          grid: {
            linePitch: pt(BODY_LINE_PT),
            type: DocumentGridType.LINES,
          },
          page: {
            margin: {
              bottom: mm(PAGE_MARGIN_BOTTOM_MM),
              footer: mm(20),
              gutter: 0,
              header: mm(15),
              left: mm(PAGE_MARGIN_LEFT_MM),
              right: mm(PAGE_MARGIN_RIGHT_MM),
              top: mm(PAGE_MARGIN_TOP_MM),
            },
            pageNumbers: { start: 1 },
            size: {
              height: mm(PAGE_HEIGHT_MM),
              orientation: PageOrientation.PORTRAIT,
              width: mm(PAGE_WIDTH_MM),
            },
          },
          titlePage: true,
        },
        footers: {
          default: pageNumberRight,
          even: createPageNumberFooter('left'),
          first: pageNumberRight,
        },
        children: [
          ...createRedHeader(metadata),
          createTitle(body.title),
          ...createPrimaryRecipient(metadata.primaryRecipient),
          ...createBodyParagraphs(body),
          ...createSignature(metadata),
          createVersionRecord(metadata),
        ],
      },
    ],
  });

  return Packer.toBlob(document);
}

export function sanitizeOfficialDocumentFilename(filename: string) {
  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();

  return sanitized || '红头文件';
}

export function downloadOfficialDocumentDocx(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeOfficialDocumentFilename(filename)}.docx`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
