// 模型生成工具参数时会把中文弯引号、破折号规范化成 ASCII，编辑器正文里却是全角的。
// 折叠只用于匹配，且每个字符一换一，折叠文本上的下标可以直接用回原文。
const MATCH_FOLD_MAP: Record<string, string> = {
  ' ': ' ',
  '　': ' ',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
};

const MATCH_FOLD_PATTERN = /[ 　–—‘’“”]/g;

const CJK_PATTERN = /[　-〿一-鿿＀-￯]/;

export function foldForMatch(text: string) {
  return text.replace(MATCH_FOLD_PATTERN, (char) => MATCH_FOLD_MAP[char]);
}

// 写回正文时反过来：把模型给的 ASCII 引号还原成公文使用的全角引号。
// 只处理挨着中文的引号，避免破坏英文缩写和代码片段。
export function restoreCjkQuotes(text: string) {
  let doubleOpen = true;
  let singleOpen = true;

  return text.replace(/["']/g, (char, index: number) => {
    const previous = text[index - 1] ?? '';
    const next = text[index + 1] ?? '';

    if (!CJK_PATTERN.test(previous) && !CJK_PATTERN.test(next)) {
      return char;
    }

    if (char === '"') {
      const quote = doubleOpen ? '“' : '”';
      doubleOpen = !doubleOpen;

      return quote;
    }

    const quote = singleOpen ? '‘' : '’';
    singleOpen = !singleOpen;

    return quote;
  });
}
