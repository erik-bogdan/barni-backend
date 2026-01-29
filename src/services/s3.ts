import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getLogger } from "../lib/logger"

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`${key} is missing`)
  return value
}

function normalizeBaseUrl(base: string): string {
  return base.endsWith("/") ? base.slice(0, -1) : base
}

export function getS3Client() {
  const endpoint = requireEnv("S3_ENDPOINT")
  const accessKeyId = requireEnv("S3_ACCESS_KEY")
  const secretAccessKey = requireEnv("S3_SECRET_KEY")
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true"

  return new S3Client({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  })
}

export async function uploadBuffer(params: {
  key: string
  body: Buffer
  contentType: string
  cacheControl?: string
}) {
  const logger = getLogger()
  const bucket = requireEnv("S3_BUCKET")
  const client = getS3Client()
  const start = Date.now()
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl,
      }),
    )
    const durationMs = Date.now() - start
    logger.info(
      {
        bucket,
        key: params.key,
        bytes: params.body.length,
        durationMs,
      },
      "s3.uploaded",
    )
  } catch (error) {
    const durationMs = Date.now() - start
    logger.error(
      {
        bucket,
        key: params.key,
        bytes: params.body.length,
        durationMs,
        err: error,
      },
      "s3.upload_failed",
    )
    throw error
  }
}

export function buildPublicUrl(key: string): string {
  const bucket = requireEnv("S3_BUCKET")
  const base = process.env.PUBLIC_ASSET_BASE_URL || process.env.S3_ENDPOINT
  if (!base) throw new Error("PUBLIC_ASSET_BASE_URL or S3_ENDPOINT is missing")
  return `${normalizeBaseUrl(base)}/${bucket}/${key}`
}

export function extractKeyFromPublicUrl(url: string): string | null {
  try {
    const bucket = requireEnv("S3_BUCKET")
    const base = process.env.PUBLIC_ASSET_BASE_URL || process.env.S3_ENDPOINT
    if (!base) return null
    const normalizedBase = normalizeBaseUrl(base)
    const prefix = `${normalizedBase}/${bucket}/`
    if (!url.startsWith(prefix)) return null
    return url.slice(prefix.length)
  } catch {
    return null
  }
}

export async function getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const bucket = requireEnv("S3_BUCKET")
  const client = getS3Client()
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })
  return await getSignedUrl(client, command, { expiresIn })
}
