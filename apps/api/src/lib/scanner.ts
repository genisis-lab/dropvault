import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Bindings } from "../types";

// Optional service-binding hook. The scanner receives a streamed body plus
// metadata headers and returns { verdict: "clean" | "infected", detail? }.
// Bytes never have to be buffered inside the Dropvault Worker.
export async function scanFile(
  env: Bindings,
  fileId: string,
  cleanStatus: "ready" | "quarantined" = "ready",
): Promise<void> {
  if (!env.SCANNER) return;
  const db = getDb(env.DB);
  const file = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .get()
    .catch(() => null);
  if (!file) return;
  try {
    const object = await env.FILES.get(file.r2Key);
    if (!object) throw new Error("object missing");
    const response = await env.SCANNER.fetch(
      "https://dropvault-scanner.internal/scan",
      {
        method: "POST",
        headers: {
          "Content-Type": file.contentType || "application/octet-stream",
          "X-Dropvault-File-Id": file.id,
          "X-Dropvault-Filename": encodeURIComponent(file.filename),
        },
        body: object.body,
      },
    );
    if (!response.ok) throw new Error(`scanner returned ${response.status}`);
    const result = await response.json<{ verdict?: string; detail?: string }>();
    const clean = result.verdict === "clean";
    await db
      .update(schema.files)
      .set({
        status: clean ? cleanStatus : "quarantined",
        scanStatus: clean ? "clean" : "infected",
        scanResult: String(result.detail || result.verdict || "unknown").slice(
          0,
          1000,
        ),
      })
      .where(eq(schema.files.id, file.id))
      .run();
  } catch (error) {
    await db
      .update(schema.files)
      .set({
        status: "quarantined",
        scanStatus: "error",
        scanResult: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 1000),
      })
      .where(eq(schema.files.id, file.id))
      .run()
      .catch(() => {});
  }
}
