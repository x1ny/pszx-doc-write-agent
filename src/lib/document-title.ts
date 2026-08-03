const DEFAULT_DOCUMENT_TITLE = "未命名文档"
const MAX_DOCUMENT_TITLE_LENGTH = 30

/**
 * 从文件名和正文推导一个可读标题。
 *
 * 用户很少手动改文件名，所以文件名仍是默认值时退回正文的第一行有效内容。
 * 会话标题和文档存档标题共用这套规则，保证侧边栏和存档卡片的叫法一致。
 */
export function getDocumentTitle(filename: string, markdown: string) {
  const normalizedFilename = filename.replace(/\s+/g, " ").trim()

  if (normalizedFilename && normalizedFilename !== DEFAULT_DOCUMENT_TITLE) {
    return normalizedFilename.slice(0, MAX_DOCUMENT_TITLE_LENGTH)
  }

  const firstContentLine = markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/[*_`~]/g, "")
        .trim()
    )
    .find(Boolean)

  return (
    firstContentLine ||
    normalizedFilename ||
    DEFAULT_DOCUMENT_TITLE
  ).slice(0, MAX_DOCUMENT_TITLE_LENGTH)
}
