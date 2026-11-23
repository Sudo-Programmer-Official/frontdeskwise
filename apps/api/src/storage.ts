import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const defaultMaxDocumentBytes = 25 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function awsRegion(): string {
  return process.env.AWS_REGION?.trim() || process.env.FRONTDESKWISE_AWS_REGION?.trim() || "";
}

export function s3Bucket(): string {
  return process.env.FRONTDESKWISE_S3_BUCKET?.trim() || "";
}

export function storageConfigured(): boolean {
  return Boolean(awsRegion() && s3Bucket());
}

export function storageConfigurationMessage(): string {
  return "Document storage is not configured. Set AWS_REGION and FRONTDESKWISE_S3_BUCKET.";
}

export function maxDocumentBytes(): number {
  const configured = Number(process.env.FRONTDESKWISE_MAX_DOCUMENT_BYTES ?? defaultMaxDocumentBytes);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : defaultMaxDocumentBytes;
}

export function isAllowedDocumentType(contentType: string): boolean {
  return allowedDocumentTypes.has(contentType.trim().toLowerCase());
}

export function allowedDocumentTypeList(): string[] {
  return [...allowedDocumentTypes].sort();
}

export function safeDocumentFileName(fileName: string): string {
  const baseName = fileName.trim().split(/[\\/]/).pop() || "document";
  const safeName = baseName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return safeName || "document";
}

export function organizationDocumentKey(input: {
  organizationId: string;
  businessId?: string | null;
  documentId: string;
  fileName: string;
}): string {
  const scope = input.businessId || "organization";
  return `organizations/${input.organizationId}/businesses/${scope}/documents/${input.documentId}/${safeDocumentFileName(input.fileName)}`;
}

function client(): S3Client {
  if (!storageConfigured()) throw new Error(storageConfigurationMessage());
  return new S3Client({ region: awsRegion() });
}

export async function createDocumentUpload(input: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<{ url: string; expiresAt: string; headers: Record<string, string> }> {
  const expiresIn = Math.min(900, Math.max(60, input.expiresInSeconds ?? 600));
  const command = new PutObjectCommand({
    Bucket: s3Bucket(),
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    ServerSideEncryption: "AES256",
  });
  return {
    url: await getSignedUrl(client(), command, { expiresIn }),
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    headers: { "content-type": input.contentType, "x-amz-server-side-encryption": "AES256" },
  };
}

export async function inspectDocumentObject(key: string): Promise<HeadObjectCommandOutput> {
  return client().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
}

export async function readDocumentObject(key: string): Promise<Buffer> {
  const result = await client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }));
  if (!result.Body) throw new Error("Uploaded document has no readable body");
  if (typeof result.Body.transformToByteArray === "function") {
    return Buffer.from(await result.Body.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function createDocumentDownload(key: string, fileName: string): Promise<{ url: string; expiresAt: string }> {
  const expiresIn = 600;
  const command = new GetObjectCommand({
    Bucket: s3Bucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeDocumentFileName(fileName)}"`,
  });
  return {
    url: await getSignedUrl(client(), command, { expiresIn }),
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
  };
}

export async function deleteDocumentObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }));
}
