import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptEncryptedMetadata,
  decryptEncryptedPayload,
  downloadDecryptedFile,
  downloadOwnedFile,
  encryptForUpload,
  MAX_BROWSER_ENCRYPTION_BYTES,
  saveEncryptionKey,
} from "./encryption";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installMemoryKeyStore() {
  const keys = new Map<IDBValidKey, unknown>();
  const database = {
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: () => {
      const transaction: {
        error: null;
        oncomplete?: () => void;
        objectStore: () => {
          put: (value: unknown, key: IDBValidKey) => void;
          get: (key: IDBValidKey) => IDBRequest;
          getAllKeys: () => IDBRequest;
          getAll: () => IDBRequest;
        };
      } = {
        error: null,
        objectStore: () => ({
          put: (value, key) => {
            keys.set(key, value);
            queueMicrotask(() => transaction.oncomplete?.());
          },
          get: (key) => {
            const request = { result: undefined } as unknown as IDBRequest;
            queueMicrotask(() => {
              Object.assign(request, { result: keys.get(key) });
              request.onsuccess?.(new Event("success"));
            });
            return request;
          },
          getAllKeys: () => {
            const request = { result: undefined } as unknown as IDBRequest;
            queueMicrotask(() => {
              Object.assign(request, { result: Array.from(keys.keys()) });
              request.onsuccess?.(new Event("success"));
            });
            return request;
          },
          getAll: () => {
            const request = { result: undefined } as unknown as IDBRequest;
            queueMicrotask(() => {
              Object.assign(request, { result: Array.from(keys.values()) });
              request.onsuccess?.(new Event("success"));
            });
            return request;
          },
        }),
      };
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {
        result: database,
        error: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.(new Event("success")));
      return request;
    },
  });
}

describe("client-side encryption", () => {
  it("round-trips file bytes and private metadata", async () => {
    const source = new File(["top secret\n"], "private-note.txt", {
      type: "text/plain",
      lastModified: 123,
    });
    const encrypted = await encryptForUpload(source);
    const clear = await decryptEncryptedPayload(
      await encrypted.file.arrayBuffer(),
      encrypted.key,
      encrypted.nonce,
      encrypted.encryptedMetadata,
    );

    expect(new TextDecoder().decode(clear.bytes)).toBe("top secret\n");
    expect(clear.filename).toBe("private-note.txt");
    expect(clear.contentType).toBe("text/plain");
    // AES-GCM appends a 128-bit authentication tag to the encrypted payload.
    expect(encrypted.file.size).toBe(source.size + 16);
    expect(
      new TextDecoder().decode(await encrypted.file.arrayBuffer()),
    ).not.toContain("top secret");
    expect(encrypted.encryptedMetadata).not.toContain("private-note.txt");
    await expect(
      decryptEncryptedMetadata(encrypted.key, encrypted.encryptedMetadata),
    ).resolves.toEqual({
      filename: "private-note.txt",
      contentType: "text/plain",
    });
  });

  it("rejects files above the browser encryption limit", async () => {
    const oversized = {
      size: MAX_BROWSER_ENCRYPTION_BYTES + 1,
    } as File;
    await expect(encryptForUpload(oversized)).rejects.toThrow(
      "limited to 256 MB",
    );
  });

  it("rejects a wrong key", async () => {
    const source = new File(["payload"], "payload.txt");
    const encrypted = await encryptForUpload(source);
    const other = await encryptForUpload(new File(["other"], "other.txt"));
    await expect(
      decryptEncryptedPayload(
        await encrypted.file.arrayBuffer(),
        other.key,
        encrypted.nonce,
        encrypted.encryptedMetadata,
      ),
    ).rejects.toThrow();
  });

  it("decrypts an E2E owner download before creating the saved blob", async () => {
    installMemoryKeyStore();
    const source = new File(["download me"], "private.txt", {
      type: "text/plain",
    });
    const encrypted = await encryptForUpload(source);
    await saveEncryptionKey("file-1", encrypted.key, {
      nonce: encrypted.nonce,
      encryptedMetadata: encrypted.encryptedMetadata,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(await encrypted.file.arrayBuffer(), { status: 200 }),
      ),
    );
    const captured: { blob?: Blob } = {};
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        captured.blob = blob;
        return "blob:decrypted";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadOwnedFile(
      {
        id: "file-1",
        filename: "Encrypted file",
        encryptionMode: "aes-gcm",
      },
      "/api/files/file-1/download",
    );

    expect(fetch).toHaveBeenCalledWith("/api/files/file-1/download", {
      credentials: "include",
    });
    expect(captured.blob).toBeDefined();
    if (!captured.blob) throw new Error("Download did not create a blob");
    const outputBlob = captured.blob;
    const savedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(outputBlob);
    });
    expect(savedText).toBe("download me");
    expect(click).toHaveBeenCalledOnce();
  });

  it("explains why a legacy ciphertext upload without a nonce is unrecoverable", async () => {
    installMemoryKeyStore();
    const encrypted = await encryptForUpload(
      new File(["legacy"], "legacy.txt"),
    );
    await saveEncryptionKey("legacy-file", encrypted.key);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadDecryptedFile(
        { id: "legacy-file" },
        "/api/files/legacy-file/download",
      ),
    ).rejects.toThrow("production backend was not upgraded");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
