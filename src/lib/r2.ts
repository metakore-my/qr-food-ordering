import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { log } from "./logger";

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

let _r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!_r2Client) {
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _r2Client;
}

export async function createPresignedUploadUrl(
  contentType: string,
  folder: string = "menu"
) {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType as AllowedContentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  const ext = contentType.split("/")[1] || "jpg";
  const key = `${folder}/${nanoid()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(getR2Client(), command, { expiresIn: 300 });

  return {
    uploadUrl: url,
    publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
    key,
  };
}

/** One object listed from the bucket. */
export interface R2Object {
  key: string;
  lastModified: Date | null;
}

/**
 * List every object under `prefix` (paginated). Used by the cron orphan-image
 * sweep to diff the bucket against the keys still referenced in the DB. Returns
 * `null` (not `[]`) on failure so the caller can distinguish "bucket is empty"
 * from "the list call errored" — the orphan sweep MUST NOT treat an errored list
 * as "no objects" (that path is safe) nor an empty live-ref set as "delete all"
 * (that path is handled by the caller's guard).
 */
export async function listR2Objects(prefix = "menu/"): Promise<R2Object[] | null> {
  try {
    const out: R2Object[] = [];
    let token: string | undefined;
    do {
      const res = await getR2Client().send(
        new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET_NAME!,
          Prefix: prefix,
          ContinuationToken: token,
        })
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  } catch (error) {
    log.error("R2", "Failed to list objects", {
      prefix,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return null;
  }
}

/** Delete a single object by its raw bucket key (not a public URL). */
export async function deleteR2Key(key: string): Promise<boolean> {
  if (!key || key.includes("..")) {
    log.warn("R2", "Delete skipped: invalid key", { key });
    return false;
  }
  try {
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })
    );
    return true;
  } catch (error) {
    log.error("R2", "Failed to delete object by key", {
      key,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/** Extract the bucket key from a public R2 URL, or null if it isn't one. */
export function keyFromPublicUrl(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const prefix = process.env.R2_PUBLIC_URL;
  if (!prefix || !publicUrl.startsWith(prefix + "/")) return null;
  const key = publicUrl.slice(prefix.length + 1);
  if (!key || key.includes("..")) return null;
  return key;
}

export async function deleteR2Object(publicUrl: string): Promise<boolean> {
  try {
    const prefix = process.env.R2_PUBLIC_URL!;
    if (!publicUrl.startsWith(prefix + "/")) {
      log.warn("R2", "Delete skipped: URL does not match R2 prefix", { publicUrl });
      return false;
    }
    const key = publicUrl.slice(prefix.length + 1);
    if (!key || key.includes("..")) {
      log.warn("R2", "Delete skipped: invalid key extracted", { publicUrl, key });
      return false;
    }

    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    log.error("R2", "Failed to delete object", {
      publicUrl,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}
