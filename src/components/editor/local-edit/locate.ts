import { foldForMatch } from './punctuation';

import type { LocalEdit } from '@/components/editor/document-editor-context';

export type LocateResult =
  | { ok: true; targetStart: number }
  | { ok: false; message: string };

/**
 * 在段落原文中定位 targetText 的起始下标。
 *
 * expectedText 只是定位用的上下文，允许是段落的一个片段；targetText 限定在
 * expectedText 命中的区间内查找，段落里出现同样文字时才不会改错位置。
 */
export function locateLocalEdit(
  currentText: string,
  edit: Pick<LocalEdit, 'expectedText' | 'targetText'>
): LocateResult {
  const foldedCurrent = foldForMatch(currentText);
  const foldedExpected = foldForMatch(edit.expectedText);
  const contextStart = foldedCurrent.indexOf(foldedExpected);

  if (contextStart < 0) {
    return {
      ok: false,
      message: `expectedText 不在该段落中，该段落当前实际内容为：${currentText}`,
    };
  }

  const contextEnd = contextStart + foldedExpected.length;
  const offsetInContext = foldedCurrent
    .slice(contextStart, contextEnd)
    .indexOf(foldForMatch(edit.targetText));

  if (offsetInContext < 0) {
    return {
      ok: false,
      message: `targetText 不在 expectedText 范围内，expectedText 对应的原文为：${currentText.slice(contextStart, contextEnd)}`,
    };
  }

  return { ok: true, targetStart: contextStart + offsetInContext };
}
