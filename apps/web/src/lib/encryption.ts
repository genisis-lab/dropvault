export const MAX_BROWSER_ENCRYPTION_BYTES = 256 * 1024 * 1024;

type StoredKey = { key: string; savedAt: number };
type EncryptedMetadata = { nonce: string; ciphertext: string };

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000)
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function openKeys(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dropvault-encryption", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveEncryptionKey(
  fileId: string,
  key: string,
): Promise<void> {
  const db = await openKeys();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(
      { key, savedAt: Date.now() } satisfies StoredKey,
      fileId,
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getEncryptionKey(fileId: string): Promise<string | null> {
  const db = await openKeys();
  const value = await new Promise<StoredKey | undefined>((resolve, reject) => {
    const request = db.transaction("keys").objectStore("keys").get(fileId);
    request.onsuccess = () => resolve(request.result as StoredKey | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value?.key ?? null;
}

export async function encryptForUpload(source: File): Promise<{
  file: File;
  key: string;
  nonce: string;
  encryptedMetadata: string;
}> {
  if (source.size > MAX_BROWSER_ENCRYPTION_BYTES)
    throw new Error("Browser encryption is limited to 256 MB per file");
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    await source.arrayBuffer(),
  );
  const metadataNonce = crypto.getRandomValues(new Uint8Array(12));
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      filename: source.name,
      contentType: source.type || "application/octet-stream",
    }),
  );
  const metadataCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: metadataNonce },
    key,
    metadata,
  );
  const encryptedMetadata: EncryptedMetadata = {
    nonce: base64Url(metadataNonce),
    ciphertext: base64Url(metadataCiphertext),
  };
  return {
    file: new File([ciphertext], source.name, {
      type: "application/octet-stream",
      lastModified: source.lastModified,
    }),
    key: base64Url(rawKey),
    nonce: base64Url(nonce),
    encryptedMetadata: JSON.stringify(encryptedMetadata),
  };
}

async function metadataFor(
  key: CryptoKey,
  encryptedMetadata?: string | null,
): Promise<{ filename: string; contentType: string }> {
  try {
    const parsed = JSON.parse(encryptedMetadata || "") as EncryptedMetadata;
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parsed.nonce) },
      key,
      fromBase64Url(parsed.ciphertext),
    );
    const value = JSON.parse(new TextDecoder().decode(clear));
    return {
      filename: String(value.filename || "Decrypted file"),
      contentType: String(value.contentType || "application/octet-stream"),
    };
  } catch {
    return {
      filename: "Decrypted file",
      contentType: "application/octet-stream",
    };
  }
}

export async function decryptEncryptedPayload(
  payload: ArrayBuffer,
  encodedKey: string,
  nonce: string,
  encryptedMetadata?: string | null,
): Promise<{
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
}> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(encodedKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(nonce) },
    key,
    payload,
  );
  return { bytes, ...(await metadataFor(key, encryptedMetadata)) };
}

export async function downloadDecryptedFile(
  file: {
    id: string;
    encryptionNonce?: string | null;
    encryptedMetadata?: string | null;
  },
  downloadUrl: string,
): Promise<void> {
  const encodedKey = await getEncryptionKey(file.id);
  if (!encodedKey || !file.encryptionNonce)
    throw new Error(
      "This browser does not have the encryption key for this file",
    );
  const response = await fetch(downloadUrl, { credentials: "include" });
  if (!response.ok) throw new Error("Encrypted download failed");
  const clear = await decryptEncryptedPayload(
    await response.arrayBuffer(),
    encodedKey,
    file.encryptionNonce,
    file.encryptedMetadata,
  );
  const url = URL.createObjectURL(
    new Blob([clear.bytes], { type: clear.contentType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = clear.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
