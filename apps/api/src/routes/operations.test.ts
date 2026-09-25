import { beforeEach, describe, expect, it, vi } from "vitest";
import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import operations from "./operations";
import filesRoute from "./files";
import adminRoute from "./admin";
import { refreshOperationalAlerts } from "../lib/operations";
const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  userId: "u1",
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set("userId", state.userId);
    c.set("userEmail", "owner@example.com");
    await next();
  },
}));
vi.mock("../middleware/admin", async () => ({
  ...(await vi.importActual<typeof import("../middleware/admin")>(
    "../middleware/admin",
  )),
  adminRole: async () => state.role,
}));
let sql: DatabaseSync;
let env: any;
function statement(query: string, values: any[] = []): any {
  return {
    bind: (...v: any[]) => statement(query, v),
    first: async () => sql.prepare(query).get(...values) ?? null,
    raw: async () => {
      const statement = sql.prepare(query);
      statement.setReturnArrays(true);
      return statement.all(...values);
    },
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => ({
      success: true,
      meta: sql.prepare(query).run(...values),
    }),
  };
}
const request = (path: string, body?: unknown) =>
  operations.request(
    `http://localhost${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
    env,
  );
beforeEach(() => {
  sql?.close();
  sql = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL(file, dir), "utf8"));
  sql.exec(
    `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('u1','Owner','owner@example.com',1,1,1),('u2','Other','other@example.com',1,1,1)`,
  );
  state.role = "owner";
  state.userId = "u1";
  env = {
    ADMIN_EMAILS: "owner@example.com",
    DB: { prepare: (q: string) => statement(q) },
    FILES: {
      head: vi.fn(async () => null),
      list: vi.fn(async () => ({ objects: [], truncated: false })),
      delete: vi.fn(async () => {}),
    },
  };
});
function addFile(key: string, owner = "u1") {
  sql
    .prepare(
      "INSERT INTO files(id,owner_id,r2_key,filename,content_type,size_bytes,status,created_at,expires_at) VALUES(?,?,?,?,?,?,'ready',?,?)",
    )
    .run(key, owner, key, "private.heic", "image/heic", 100, 1, 9999999999);
}
describe("operations API", () => {
  it("deduplicates reports, strips unowned file IDs, and rejects invalid stages", async () => {
    addFile("other", "u2");
    const body = {
      attemptId: "attempt-1",
      fileId: "other",
      stage: "uploading",
      outcome: "failed",
      category: "network",
      sizeBytes: 100,
      durationMs: 1000,
    };
    expect((await request("/upload-event", body)).status).toBe(200);
    expect(
      (
        await request("/upload-event", {
          ...body,
          outcome: "success",
          stage: "finishing",
        })
      ).status,
    ).toBe(200);
    const rows = sql.prepare("SELECT * FROM upload_diagnostics").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].file_id).toBeNull();
    expect(rows[0].outcome).toBe("success");
    expect(
      (await request("/upload-event", { ...body, stage: "native-picker" }))
        .status,
    ).toBe(400);
  });
  it("keeps operational reads private and cleanup owner-only", async () => {
    for (const role of [null, "moderator"]) {
      state.role = role;
      expect((await request("/health")).status).toBe(403);
    }
    state.role = "auditor";
    expect((await request("/diagnostics")).status).toBe(200);
    expect(
      (
        await request("/reconciliation/cleanup", {
          keys: ["x"],
          confirmation: "DELETE REVIEWED ORPHANS",
        })
      ).status,
    ).toBe(403);
  });
  it("rechecks references and the grace period before deleting reviewed objects", async () => {
    addFile("live");
    env.FILES.head.mockImplementation(async (key: string) => ({
      key,
      uploaded: new Date(key === "new" ? Date.now() : 0),
    }));
    const response = await request("/reconciliation/cleanup", {
      keys: ["live", "live/thumb", "new", "orphan"],
      confirmation: "DELETE REVIEWED ORPHANS",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: 1, skipped: 3 });
    expect(env.FILES.delete).toHaveBeenCalledExactlyOnceWith("orphan");
  });
  it("does not delete anything when reference lookup fails", async () => {
    env.FILES.head.mockResolvedValue({ uploaded: new Date(0) });
    sql.exec("DROP TABLE file_versions");
    expect(
      (
        await request("/reconciliation/cleanup", {
          keys: ["orphan"],
          confirmation: "DELETE REVIEWED ORPHANS",
        })
      ).status,
    ).toBe(500);
    expect(env.FILES.delete).not.toHaveBeenCalled();
  });
  it("detects missing files and versions without modifying storage", async () => {
    addFile("missing");
    const res = await request("/reconciliation?direction=missing");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).items).toHaveLength(1);
    expect(env.FILES.delete).not.toHaveBeenCalled();
  });
  it("deduplicates alerts and automatically resolves recovery", async () => {
    await refreshOperationalAlerts(env);
    await refreshOperationalAlerts(env);
    expect(
      sql.prepare("SELECT * FROM operational_alerts WHERE status='open'").all(),
    ).toHaveLength(1);
    sql
      .prepare(
        "INSERT INTO operation_runs(name,started_at,last_success_at,status) VALUES('expiration-sweep',?,?,'ok')",
      )
      .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    await refreshOperationalAlerts(env);
    expect(
      sql
        .prepare(
          "SELECT status FROM operational_alerts WHERE id='cleanup-overdue'",
        )
        .get()?.status,
    ).toBe("resolved");
  });
});

describe("owner upload and preview routes", () => {
  it("streams video with range support and safe media headers", async () => {
    addFile("clip");
    sql.exec("UPDATE files SET content_type='video/mp4' WHERE id='clip'");
    env.FILES.head.mockResolvedValue({ size: 100, httpEtag: "etag" });
    env.FILES.get = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      writeHttpMetadata: (headers: Headers) =>
        headers.set("Content-Type", "video/mp4"),
    }));
    const response = await filesRoute.request(
      "http://localhost/clip/inline",
      { headers: { Range: "bytes=0-2" } },
      env,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-2/100");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "sandbox",
    );
    expect(env.FILES.get).toHaveBeenCalledExactlyOnceWith("clip", {
      range: { offset: 0, length: 3 },
    });
  });
  it("keeps sandbox protection for uploaded SVG content", async () => {
    addFile("svg");
    sql.exec("UPDATE files SET content_type='image/svg+xml' WHERE id='svg'");
    env.FILES.head.mockResolvedValue({ size: 3 });
    env.FILES.get = vi.fn(async () => ({
      body: "svg",
      writeHttpMetadata: () => {},
    }));
    const response = await filesRoute.request(
      "http://localhost/svg/inline",
      undefined,
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
  });
  it("does not cancel an already completed or another user's upload", async () => {
    addFile("done");
    addFile("other", "u2");
    for (const id of ["done", "other"])
      expect(
        (
          await filesRoute.request(
            `http://localhost/${id}/cancel-upload`,
            { method: "POST" },
            env,
          )
        ).status,
      ).toBe(200);
    expect(env.FILES.delete).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT id FROM files").all()).toHaveLength(2);
  });
  it("cancels a pending upload and clears its reservation", async () => {
    addFile("pending");
    sql.exec("UPDATE files SET status='pending' WHERE id='pending'");
    sql.exec("INSERT INTO upload_reservations(id,user_id,file_id,bytes,status,created_at,expires_at) VALUES('reservation','u1','pending',100,'active',1,9999999999)");
    const response = await filesRoute.request(
      "http://localhost/pending/cancel-upload",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completed: false });
    expect(env.FILES.delete).toHaveBeenCalledExactlyOnceWith([
      "pending",
      "pending/thumb",
    ]);
    expect(sql.prepare("SELECT id FROM files").all()).toHaveLength(0);
    expect(sql.prepare("SELECT id FROM upload_reservations").all()).toHaveLength(0);
  });
  it("extending a permanent file preserves its lifetime", async () => {
    addFile("permanent");
    sql.exec(
      "UPDATE files SET keep_forever=1,expires_at=253402300799 WHERE id='permanent'",
    );
    const response = await filesRoute.request(
      "http://localhost/permanent",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extendDays: 7 }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(
      sql
        .prepare(
          "SELECT keep_forever,expires_at FROM files WHERE id='permanent'",
        )
        .get(),
    ).toMatchObject({ keep_forever: 1, expires_at: 253402300799 });
  });
});
describe("policy impact preview", () => {
  it("counts defaults and eligible trash without applying changes", async () => {
    addFile("old-trash");
    sql.exec("UPDATE files SET deleted_at=1 WHERE id='old-trash'");
    const response = await adminRoute.request(
      "http://localhost/settings/impact",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { trashRetentionDays: "7", defaultQuotaBytes: "200" },
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "trashRetentionDays", count: 1 }),
        expect.objectContaining({ key: "defaultQuotaBytes", count: 2 }),
      ]),
    );
    expect(sql.prepare("SELECT * FROM app_settings").all()).toHaveLength(0);
    expect(sql.prepare("SELECT * FROM files").all()).toHaveLength(1);
  });
});
