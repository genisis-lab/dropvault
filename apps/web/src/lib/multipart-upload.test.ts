import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MULTIPART_PART_SIZE,
  UploadTransportError,
  uploadCheckpointMustBeCleared,
  uploadLargeFile,
} from "./api";

type XhrReply = { status: number; body: Record<string, unknown> };

let xhrReply: (url: string, body: Blob) => XhrReply;
let xhrUrls: string[];

class FakeXMLHttpRequest {
  status = 0;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";
  private aborted = false;
  abort() { this.aborted = true; this.onabort?.(); }

  open(_method: string, url: string) {
    this.url = url;
  }

  send(body: Blob) {
    xhrUrls.push(this.url);
    const reply = xhrReply(this.url, body);
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: body.size,
      total: body.size,
    } as ProgressEvent);
    if (this.aborted) return;
    this.status = reply.status;
    this.responseText = JSON.stringify(reply.body);
    this.onload?.();
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function largeFile(megabytes = 218): File {
  const size = megabytes * 1024 * 1024;
  return {
    name: "large.bin",
    size,
    type: "application/octet-stream",
    lastModified: 1,
    slice(start = 0, end = size) {
      return { size: Math.max(0, end - start) } as Blob;
    },
  } as File;
}

beforeEach(() => {
  xhrUrls = [];
  xhrReply = (url) => {
    const partNumber = Number(new URL(url, "https://drive.test").searchParams.get("partNumber"));
    return { status: 200, body: { partNumber, etag: `etag-${partNumber}` } };
  };
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("large multipart uploads", () => {
  it("cancels between parts without finalizing or starting another request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => json({ uploadId: "upload-1", parts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadLargeFile("file-1", largeFile(), () => controller.abort(), controller.signal)).rejects.toMatchObject({code: "UPLOAD_CANCELLED"});
    expect(xhrUrls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uploads a 218 MiB file as seven bounded parts and completes it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/multipart/start"))
        return json({ uploadId: "upload-1", parts: [] });
      if (url.endsWith("/multipart/complete")) return json({ ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: number[] = [];

    await uploadLargeFile("file-1", largeFile(), (value) =>
      progress.push(value),
    );

    expect(MULTIPART_PART_SIZE).toBe(32 * 1024 * 1024);
    expect(xhrUrls).toHaveLength(7);
    expect(xhrUrls[xhrUrls.length - 1]).toContain("partNumber=7");
    expect(progress[progress.length - 1]).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retires a stale uploadId and continues under a fresh session", async () => {
    let starts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/multipart/start")) {
        starts += 1;
        return json({ uploadId: `upload-${starts}`, parts: [] });
      }
      if (url.endsWith("/multipart/complete")) return json({ ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    let firstPart = true;
    xhrReply = (url) => {
      const parsed = new URL(url, "https://drive.test");
      const partNumber = Number(parsed.searchParams.get("partNumber"));
      if (firstPart) {
        firstPart = false;
        return {
          status: 410,
          body: {
            error: "The resumable upload session expired.",
            code: "MULTIPART_SESSION_STALE",
          },
        };
      }
      return { status: 200, body: { partNumber, etag: `etag-${partNumber}` } };
    };
    const progress: number[] = [];

    await uploadLargeFile("file-1", largeFile(), (value) =>
      progress.push(value),
    );

    expect(starts).toBe(2);
    expect(xhrUrls).toHaveLength(8);
    expect(progress).toContain(0);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it("retries finalization without uploading the large parts again", async () => {
    vi.useFakeTimers();
    let completions = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/multipart/start"))
        return json({ uploadId: "upload-1", parts: [] });
      if (url.endsWith("/multipart/complete")) {
        completions += 1;
        if (completions === 1)
          return json(
            {
              error: "Upload verification is temporarily unavailable.",
              code: "MULTIPART_TRANSIENT",
            },
            503,
          );
        return json({ ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const upload = uploadLargeFile("file-1", largeFile(), () => {});
    await vi.runAllTimersAsync();
    await upload;

    expect(completions).toBe(2);
    expect(xhrUrls).toHaveLength(7);
  });

  it("keeps session-stale checkpoints but clears deleted reservations", () => {
    expect(
      uploadCheckpointMustBeCleared(
        new UploadTransportError(
          "session expired",
          410,
          "MULTIPART_SESSION_STALE",
        ),
      ),
    ).toBe(false);
    expect(
      uploadCheckpointMustBeCleared(
        new UploadTransportError(
          "upload size mismatch",
          409,
          "UPLOAD_RESTART_REQUIRED",
        ),
      ),
    ).toBe(true);
    expect(
      uploadCheckpointMustBeCleared(
        new UploadTransportError("not found", 404),
      ),
    ).toBe(true);
  });
});
