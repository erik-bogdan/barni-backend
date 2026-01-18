import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

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
  const bucket = requireEnv("S3_BUCKET")
  const client = getS3Client()
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: params.cacheControl,
    }),
  )
}

export function buildPublicUrl(key: string): string {
  const bucket = requireEnv("S3_BUCKET")
  const base = process.env.PUBLIC_ASSET_BASE_URL || process.env.S3_ENDPOINT
  if (!base) throw new Error("PUBLIC_ASSET_BASE_URL or S3_ENDPOINT is missing")
  return `${normalizeBaseUrl(base)}/${bucket}/${key}`
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
