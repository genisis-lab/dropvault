import type { Bindings } from "../types";

export const OPERATION_DEFAULTS = {
  failurePercent: 15,
  minAttempts: 10,
  staleHours: 3,
  storageGrowthGiB: 10,
};
export type OperationThresholds = typeof OPERATION_DEFAULTS;
export function normalizeThresholds(
  input: Partial<OperationThresholds>,
): OperationThresholds {
  const range = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  return {
    failurePercent: range(input.failurePercent, 15, 1, 100),
    minAttempts: Math.round(range(input.minAttempts, 10, 1, 10000)),
    staleHours: range(input.staleHours, 3, 2, 168),
    storageGrowthGiB: range(input.storageGrowthGiB, 10, 0.1, 100000),
  };
}
export function clientPlatform(agent: string) {
  return {
    browser: /Edg/i.test(agent)
      ? "Edge"
      : /CriOS|Chrome/i.test(agent)
        ? "Chrome"
        : /FxiOS|Firefox/i.test(agent)
          ? "Firefox"
          : /Safari/i.test(agent)
            ? "Safari"
            : "Other",
    os: /iPhone|iPad|iPod/.test(agent)
      ? "iOS"
      : /Android/.test(agent)
        ? "Android"
        : /Macintosh/.test(agent)
          ? "macOS / iPadOS"
          : /Windows/.test(agent)
            ? "Windows"
            : "Other",
  };
}
export async function recordOperation(
  env: Bindings,
  name: string,
  operation: () => Promise<unknown>,
) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO operation_runs(name,started_at,status) VALUES(?,?,'running') ON CONFLICT(name) DO UPDATE SET started_at=excluded.started_at, finished_at=NULL, status='running', detail=NULL",
  )
    .bind(name, now)
    .run();
  try {
    const result = await operation();
    const finished = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE operation_runs SET finished_at=?,last_success_at=?,status='ok',detail=? WHERE name=?",
    )
      .bind(
        finished,
        finished,
        typeof result === "number" ? name === "orphan-scan" ? `${result} candidates in the first 500 objects; use reconciliation to scan further` : `${result} items processed` : "Completed",
        name,
      )
      .run();
    return result;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE operation_runs SET finished_at=?,status='error',detail=? WHERE name=?",
    )
      .bind(
        Math.floor(Date.now() / 1000),
        "Operation failed; inspect Worker logs before retrying.",
        name,
      )
      .run();
    throw error;
  }
}
export async function operationThresholds(env: Bindings) {
  const row = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key='operationThresholds'",
  ).first<{ value: string }>();
  try {
    return normalizeThresholds(JSON.parse(row?.value ?? "{}"));
  } catch {
    return OPERATION_DEFAULTS;
  }
}
export function alertConditions(
  input: {
    attempts: number;
    failures: number;
    stale: boolean;
    growthBytes: number;
  },
  thresholds: OperationThresholds,
) {
  return {
    "upload-failures":
      input.attempts >= thresholds.minAttempts &&
      (input.failures / input.attempts) * 100 >= thresholds.failurePercent,
    "cleanup-overdue": input.stale,
    "storage-growth":
      input.growthBytes >= thresholds.storageGrowthGiB * 1024 ** 3,
  };
}
export async function refreshOperationalAlerts(env: Bindings) {
  const now = Math.floor(Date.now() / 1000);
  const thresholds = await operationThresholds(env);
  const counts = await env.DB.prepare(
    "SELECT COUNT(*) attempts, COALESCE(SUM(outcome='failed'),0) failures FROM upload_diagnostics WHERE created_at>? AND outcome IN ('success','failed')",
  )
    .bind(now - 86400)
    .first<{ attempts: number; failures: number }>();
  const sweep = await env.DB.prepare(
    "SELECT last_success_at FROM operation_runs WHERE name='expiration-sweep'",
  ).first<{ last_success_at: number | null }>();
  const bytes = await env.DB.prepare(
    "SELECT COALESCE(SUM(size_bytes),0) bytes FROM files WHERE status='ready'",
  ).first<{ bytes: number }>();
  const baseline = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key='operationsStorageBaseline'",
  ).first<{ value: string }>();
  let previous: { at: number; bytes: number } | null = null;
  try {
    previous = JSON.parse(baseline?.value ?? "null");
  } catch {}
  const growth = previous
    ? Math.max(0, (bytes?.bytes ?? 0) - previous.bytes)
    : 0;
  const conditions = alertConditions(
    {
      attempts: counts?.attempts ?? 0,
      failures: counts?.failures ?? 0,
      stale:
        !sweep?.last_success_at ||
        sweep.last_success_at < now - thresholds.staleHours * 3600,
      growthBytes: growth,
    },
    thresholds,
  );
  const details = {
    "upload-failures": [
      "Elevated upload failures",
      `${counts?.failures ?? 0} of ${counts?.attempts ?? 0} reported completed attempts failed in the last 24 hours. Review stage and browser breakdowns.`,
    ],
    "cleanup-overdue": [
      "Expiration cleanup overdue",
      `No successful expiration sweep in ${thresholds.staleHours} hours. Inspect the scheduled Worker and its logs.`,
    ],
    "storage-growth": [
      "Storage growth threshold reached",
      `Stored file bytes grew by ${(growth / 1024 ** 3).toFixed(2)} GiB since the baseline. Review storage usage and recent uploads.`,
    ],
  };
  for (const [id, active] of Object.entries(conditions)) {
    if (active) {
      const [label, detail] = details[id as keyof typeof details];
      await env.DB.prepare(
        `INSERT INTO operational_alerts(id,label,detail,status,first_seen_at,last_seen_at) VALUES(?,?,?,'open',?,?)
        ON CONFLICT(id) DO UPDATE SET detail=excluded.detail,last_seen_at=excluded.last_seen_at,
        first_seen_at=CASE WHEN operational_alerts.status='resolved' THEN excluded.first_seen_at ELSE operational_alerts.first_seen_at END,
        acknowledged_at=CASE WHEN operational_alerts.status='resolved' THEN NULL ELSE operational_alerts.acknowledged_at END,
        acknowledged_by=CASE WHEN operational_alerts.status='resolved' THEN NULL ELSE operational_alerts.acknowledged_by END,
        status='open',resolved_at=NULL`,
      )
        .bind(id, label, detail, now, now)
        .run();
    } else
      await env.DB.prepare(
        "UPDATE operational_alerts SET status='resolved',resolved_at=? WHERE id=? AND status='open'",
      )
        .bind(now, id)
        .run();
  }
  if (!previous || previous.at < now - 86400)
    await env.DB.prepare(
      "INSERT INTO app_settings(key,value,updated_at) VALUES('operationsStorageBaseline',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
      .bind(JSON.stringify({ at: now, bytes: bytes?.bytes ?? 0 }), now)
      .run();
  await env.DB.prepare("DELETE FROM upload_diagnostics WHERE created_at<?")
    .bind(now - 30 * 86400)
    .run();
}
