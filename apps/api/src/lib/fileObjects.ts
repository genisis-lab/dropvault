import { inArray } from "drizzle-orm";
import { getDb, schema } from "../db";

export async function deleteFileObjects(
  bucket: R2Bucket,
  db: ReturnType<typeof getDb>,
  files: Array<{ id: string; r2Key: string }>,
): Promise<void> {
  if (!files.length) return;
  const ids = files.map((file) => file.id);
  const versions = await db
    .select({ r2Key: schema.fileVersions.r2Key })
    .from(schema.fileVersions)
    .where(inArray(schema.fileVersions.fileId, ids))
    .all()
    .catch(() => []);
  const keys = Array.from(
    new Set([
      ...files.flatMap((file) => [file.r2Key, `${file.r2Key}/thumb`]),
      ...versions.map((version) => version.r2Key),
    ]),
  );
  for (let offset = 0; offset < keys.length; offset += 100)
    await bucket.delete(keys.slice(offset, offset + 100));
}

export async function deleteOneFileObjects(
  bucket: R2Bucket,
  db: ReturnType<typeof getDb>,
  file: { id: string; r2Key: string },
): Promise<void> {
  await deleteFileObjects(bucket, db, [file]);
}
