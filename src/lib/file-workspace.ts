import path from 'node:path';

import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

export const uploadBasePath = path.join(process.cwd(), '.data', 'uploads');

// API 使用可写文件系统，Agent 使用同一目录的只读文件系统。
// 这样上传接口可以保存文件，但 Agent 不会获得删除或覆盖用户文件的能力。
export const uploadFilesystem = new LocalFilesystem({
  id: 'document-upload-filesystem',
  basePath: uploadBasePath,
});

export const documentWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    id: 'document-agent-filesystem',
    basePath: uploadBasePath,
    readOnly: true,
  }),
});

export const maxUploadSize = 10 * 1024 * 1024;

export const allowedExtensions = new Set(['.docx', '.md', '.markdown', '.txt']);

export type UploadedFileRecord = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  extension: string;
  contentPath: string;
  createdAt: string;
  sourceType?: 'system' | 'upload';
  sourceKey?: string;
  version?: number;
  checksum?: string;
};

export function getContentPath(id: string, extension: string) {
  return `${id}/content${extension}`;
}

export function getMetadataPath(id: string) {
  return `${id}/metadata.json`;
}
