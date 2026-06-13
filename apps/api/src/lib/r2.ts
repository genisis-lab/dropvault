import { S3Client } from "@aws-sdk/client-s3"
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { Bindings } from "../types"

// R2 exposes an S3-compatible endpoint. We use presigned URLs so the browser
// uploads/downloads directly to R2 and the Worker never proxies file bytes.
function s3(env: Bindings) {
  const endpoint = "https://" + env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com"
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })
}

export async function presignPut(env: Bindings, key: string, contentType?: string) {
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3(env), cmd, { expiresIn: 60 * 10 }) // 10 min to upload
}

export async function presignGet(env: Bindings, key: string, filename: string) {
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  })
  return getSignedUrl(s3(env), cmd, { expiresIn: 60 * 5 }) // 5 min to download
}
