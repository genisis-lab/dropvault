type UploadCheckpoint = { id: string; fingerprint: string; updatedAt: number };

const DB_NAME = "dropvault-uploads";
const STORE = "checkpoints";

function fingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "fingerprint" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getUploadCheckpoint(
  file: File,
): Promise<UploadCheckpoint | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await database();
  return new Promise((resolve) => {
    const request = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(fingerprint(file));
    request.onsuccess = () =>
      resolve((request.result as UploadCheckpoint | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function saveUploadCheckpoint(
  file: File,
  id: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put({
        id,
        fingerprint: fingerprint(file),
        updatedAt: Date.now(),
      } satisfies UploadCheckpoint);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearUploadCheckpoint(file: File): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await database();
  await new Promise<void>((resolve) => {
    const request = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .delete(fingerprint(file));
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}
