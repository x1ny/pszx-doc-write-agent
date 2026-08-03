import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  getContentPath,
  getMetadataPath,
  uploadStorage,
  type UploadedFileRecord,
} from '@/lib/file-storage';
import type { DocumentMaterial } from '@/lib/document-material';
import { readUploadedFileText } from '../processors/uploaded-file-prompt';

export const documentMaterialSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  extension: z.string().min(1),
  createdAt: z.string().min(1),
  sourceType: z.enum(['system', 'upload']),
  date: z.string().min(1),
  documentType: z.string().min(1),
  viewUrl: z.string().min(1),
  downloadUrl: z.string().min(1),
});

type SystemMaterialDefinition = {
  id: string;
  sourceKey: string;
  version: number;
  title: string;
  originalName: string;
  date: string;
  documentType: string;
  filePath: string;
};

const systemMaterialDefinitions: SystemMaterialDefinition[] = [
  ['2023', '2023年福建省农业农村厅工作报告'],
  ['2024', '2024年福建省农业农村厅工作报告'],
  ['2025', '2025年福建省农业农村厅工作报告'],
  ['2026', '2026年福建省农业农村厅工作报告'],
].map(([date, title]) => ({
  id: 'style-source-' + date,
  sourceKey: 'agriculture-work-report-' + date,
  version: 1,
  title,
  originalName: title + '.docx',
  date,
  documentType: '工作报告',
  filePath: resolve(
    process.cwd(),
    'src/assets/doc/农业局局长公文/' + title + '.docx'
  ),
}));

let systemMaterialInitialization: Promise<DocumentMaterial[]> | undefined;

function getMaterialUrls(id: string) {
  return {
    viewUrl: '/api/files/' + id,
    downloadUrl: '/api/files/' + id + '?download=1',
  };
}

export function createDocumentMaterial(
  record: UploadedFileRecord,
  overrides: Partial<
    Pick<DocumentMaterial, 'title' | 'date' | 'documentType'>
  > = {}
): DocumentMaterial {
  const urls = getMaterialUrls(record.id);
  return {
    id: record.id,
    title: overrides.title ?? record.originalName,
    originalName: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    extension: record.extension,
    createdAt: record.createdAt,
    sourceType: record.sourceType ?? 'upload',
    date: overrides.date ?? '上传材料',
    documentType:
      overrides.documentType ?? record.extension.replace('.', '').toUpperCase(),
    ...urls,
  };
}

function getSystemMaterialRecord(
  definition: SystemMaterialDefinition,
  checksum: string,
  size: number
): UploadedFileRecord {
  return {
    id: definition.id,
    originalName: definition.originalName,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size,
    extension: '.docx',
    contentPath: getContentPath(definition.id, '.docx'),
    createdAt: new Date().toISOString(),
    sourceType: 'system',
    sourceKey: definition.sourceKey,
    version: definition.version,
    checksum,
  };
}

async function readStoredRecord(id: string) {
  const metadataPath = getMetadataPath(id);
  if (!(await uploadStorage.exists(metadataPath))) return undefined;

  const metadata = await uploadStorage.readFile(metadataPath, {
    encoding: 'utf8',
  });
  return JSON.parse(String(metadata)) as Partial<UploadedFileRecord>;
}

async function initializeSystemMaterials() {
  await uploadStorage.init();

  return Promise.all(
    systemMaterialDefinitions.map(async (definition) => {
      const source = await readFile(definition.filePath);
      const checksum = createHash('sha256').update(source).digest('hex');
      const contentPath = getContentPath(definition.id, '.docx');
      const current = await readStoredRecord(definition.id);
      const isCurrent =
        current?.id === definition.id &&
        current.sourceType === 'system' &&
        current.sourceKey === definition.sourceKey &&
        current.version === definition.version &&
        current.checksum === checksum &&
        current.contentPath === contentPath &&
        (await uploadStorage.exists(contentPath));

      if (!isCurrent) {
        const record = getSystemMaterialRecord(
          definition,
          checksum,
          source.byteLength
        );
        await uploadStorage.writeFile(contentPath, source, {
          overwrite: true,
          mimeType: record.mimeType,
        });
        await uploadStorage.writeFile(
          getMetadataPath(definition.id),
          JSON.stringify(record, null, 2),
          {
            overwrite: true,
            mimeType: 'application/json',
          }
        );
        return createDocumentMaterial(record, definition);
      }

      return createDocumentMaterial(current as UploadedFileRecord, definition);
    })
  );
}

export function ensureSystemMaterials() {
  if (!systemMaterialInitialization) {
    systemMaterialInitialization = initializeSystemMaterials().catch((error) => {
      systemMaterialInitialization = undefined;
      throw error;
    });
  }
  return systemMaterialInitialization;
}

export async function getDocumentMaterials(): Promise<DocumentMaterial[]> {
  return ensureSystemMaterials();
}

export async function readDocumentMaterialText(materialId: string) {
  await ensureSystemMaterials();
  const article = await readUploadedFileText(materialId);
  if (!article.trim()) {
    throw new Error('材料内容为空：' + materialId);
  }
  return article.trim();
}

export type { DocumentMaterial };
