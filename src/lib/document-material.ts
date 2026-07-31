export type DocumentMaterial = {
  id: string
  title: string
  originalName: string
  mimeType: string
  size: number
  extension: string
  createdAt: string
  sourceType: "system" | "upload"
  date: string
  documentType: string
  viewUrl: string
  downloadUrl: string
}
