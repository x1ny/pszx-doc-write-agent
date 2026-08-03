import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const globalForFileStorage = globalThis as typeof globalThis & {
  documentFileStorageClient?: S3Client;
  documentFileStorageInit?: Promise<void>;
};

function getRequiredStorageEnvironment(
  key: 'MINIO_ENDPOINT' | 'MINIO_BUCKET' | 'MINIO_ACCESS_KEY' | 'MINIO_SECRET_KEY',
) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required storage environment variable: ${key}`);
  }

  return value;
}

function getBucket() {
  return getRequiredStorageEnvironment('MINIO_BUCKET');
}

// 客户端延迟创建：避免在缺少环境变量的构建阶段就抛错，也让 dev 热重载复用同一个连接池。
function getClient() {
  if (!globalForFileStorage.documentFileStorageClient) {
    globalForFileStorage.documentFileStorageClient = new S3Client({
      region: process.env.MINIO_REGION?.trim() || 'us-east-1',
      endpoint: getRequiredStorageEnvironment('MINIO_ENDPOINT'),
      // MinIO 默认不支持 virtual-host 风格的 bucket 域名，必须走 path-style。
      forcePathStyle: true,
      credentials: {
        accessKeyId: getRequiredStorageEnvironment('MINIO_ACCESS_KEY'),
        secretAccessKey: getRequiredStorageEnvironment('MINIO_SECRET_KEY'),
      },
    });
  }

  return globalForFileStorage.documentFileStorageClient;
}

// 对象存储没有目录概念，但仍要挡住绝对路径和 ..，
// 保留原先 Workspace 提供的“不能访问根目录之外”的约束。
function normalizeKey(key: string) {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');

  if (!normalized || normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`非法的对象存储路径：${key}`);
  }

  return normalized;
}

function getStatusCode(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

function isNotFound(error: unknown) {
  const name = (error as { name?: string })?.name;
  return (
    name === 'NotFound' || name === 'NoSuchKey' || getStatusCode(error) === 404
  );
}

function isPreconditionFailed(error: unknown) {
  const name = (error as { name?: string })?.name;
  return name === 'PreconditionFailed' || getStatusCode(error) === 412;
}

export type WriteFileOptions = {
  overwrite?: boolean;
  mimeType?: string;
};

export type ReadonlyFileStorage = {
  init(): Promise<void>;
  exists(key: string): Promise<boolean>;
  readFile(key: string): Promise<Buffer>;
  readFile(key: string, options: { encoding: 'utf8' }): Promise<string>;
};

async function init() {
  globalForFileStorage.documentFileStorageInit ??= (async () => {
    const client = getClient();
    const Bucket = getBucket();

    try {
      await client.send(new HeadBucketCommand({ Bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await client.send(new CreateBucketCommand({ Bucket }));
    }
  })().catch((error) => {
    globalForFileStorage.documentFileStorageInit = undefined;
    throw error;
  });

  return globalForFileStorage.documentFileStorageInit;
}

async function exists(key: string) {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: normalizeKey(key) }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readFile(key: string): Promise<Buffer>;
async function readFile(
  key: string,
  options: { encoding: 'utf8' },
): Promise<string>;
async function readFile(
  key: string,
  options?: { encoding: 'utf8' },
): Promise<Buffer | string> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: normalizeKey(key) }),
  );

  if (!response.Body) {
    throw new Error(`对象内容为空：${key}`);
  }

  // 必须走 transformToByteArray 拿原始字节。用 transformToString 会按 UTF-8 解码，
  // 导致 GB18030 文本和 docx 二进制损坏。
  const buffer = Buffer.from(await response.Body.transformToByteArray());

  return options?.encoding === 'utf8' ? buffer.toString('utf8') : buffer;
}

async function writeFile(
  key: string,
  data: Buffer | string,
  options: WriteFileOptions = {},
) {
  const Key = normalizeKey(key);
  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key,
        Body: body,
        ContentType: options.mimeType,
        // If-None-Match: * 让“不覆盖”在服务端原子完成，避免先查后写的竞态。
        ...(options.overwrite === false ? { IfNoneMatch: '*' } : {}),
      }),
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw new Error(`对象已存在，禁止覆盖：${Key}`);
    }

    throw error;
  }
}

// DeleteObject 对不存在的对象同样返回成功，不需要 force 参数。
async function deleteFile(key: string) {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: normalizeKey(key) }),
  );
}

// 对象存储没有目录，按前缀批量删除天然是递归的。
async function rmdir(prefix: string) {
  const client = getClient();
  const Bucket = getBucket();
  const normalized = `${normalizeKey(prefix).replace(/\/+$/, '')}/`;
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: normalized,
        ContinuationToken: continuationToken,
      }),
    );
    const keys =
      listed.Contents?.flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      ) ?? [];

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      );
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

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

/** 上传接口使用，可读写。 */
export const uploadStorage = {
  init,
  exists,
  readFile,
  writeFile,
  deleteFile,
  rmdir,
};

// Agent 侧只拿到读取方法，保证工具调用无法删除或覆盖用户上传的文件
// （原先由 LocalFilesystem 的 readOnly 标志保证）。
export const documentStorage: ReadonlyFileStorage = {
  init,
  exists,
  readFile,
};
