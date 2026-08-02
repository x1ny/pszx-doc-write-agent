export const DOCUMENT_TIME_ZONE = 'Asia/Shanghai';

const documentDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: DOCUMENT_TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function getCurrentDocumentDate(now: Date = new Date()) {
  return documentDateFormatter.format(now);
}
