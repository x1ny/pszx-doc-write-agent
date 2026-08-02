import type { Path, TText } from 'platejs';
import type { PlateEditor } from 'platejs/react';

import { locateLocalEdit } from './locate';
import { restoreCjkQuotes } from './punctuation';

import type { LocalEdit } from '@/components/editor/document-editor-context';

/**
 * 把段落内的字符下标换算成 Slate 的 Point：逐个 text 叶子累加长度。
 *
 * 不用 editor.api.positions，是因为它按字素簇步进，而下标来自按 UTF-16 码元
 * 计数的 indexOf，正文出现 emoji 或组合字符时两者会错位。
 */
function resolveBlockPoint(
  editor: PlateEditor,
  blockPath: Path,
  offset: number,
  edge: 'end' | 'start'
) {
  let remaining = offset;
  let lastPoint: { offset: number; path: Path } | null = null;

  for (const [leaf, leafPath] of editor.api.nodes<TText>({
    at: blockPath,
    text: true,
  })) {
    const length = leaf.text.length;

    // 起点落在叶子末尾时继续往后走，让替换文字继承后一个叶子的标记。
    if (remaining < length || (remaining === length && edge === 'end')) {
      return { offset: remaining, path: leafPath };
    }

    remaining -= length;
    lastPoint = { offset: length, path: leafPath };
  }

  return remaining === 0 ? lastPoint : null;
}

export function createLocalEditApplier(editor: PlateEditor) {
  return (edit: LocalEdit) => {
    const nodeEntry = editor.api.node(edit.path);
    const node = nodeEntry?.[0];

    if (!node || !('children' in node)) {
      return { success: false, message: '找不到目标段落' };
    }

    const currentText = editor.api.string(edit.path);
    const located = locateLocalEdit(currentText, edit);

    if (!located.ok) {
      return { success: false, message: located.message };
    }

    const start = resolveBlockPoint(
      editor,
      edit.path,
      located.targetStart,
      'start'
    );
    const end = resolveBlockPoint(
      editor,
      edit.path,
      located.targetStart + edit.targetText.length,
      'end'
    );

    if (!start || !end) {
      return { success: false, message: '无法定位目标段落范围' };
    }

    editor.tf.select({ anchor: start, focus: end });
    editor.tf.delete();
    editor.tf.insertText(restoreCjkQuotes(edit.replacement));

    return { success: true };
  };
}
