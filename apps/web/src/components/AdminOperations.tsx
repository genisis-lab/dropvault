import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBytes } from "../lib/format";
import { useToast } from "./Toast";

const API = import.meta.env.VITE_API_URL ?? "";
export async function operationalRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    credentials: "include",
    cache: "no-store",
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
        "Could not load operational data",
    );
  return response.json();
}
type Thresholds = {
  failurePercent: number;
  minAttempts: number;
  staleHours: number;
  storageGrowthGiB: number;
};
type Health = {
  runs: {
    name: string;
    status: string;
    last_success_at: number | null;
    started_at: number;
    detail: string | null;
  }[];
  stuckUploads: number;
  abandonedMultipart: number;
  thumbnailFailures: number;
  storageReachable: boolean;
  thresholds: Thresholds;
  alerts: {
    id: string;
    label: string;
    detail: string;
    status: string;
    acknowledged_at: number | null;
    resolved_at: number | null;
  }[];
};
type Diagnostics = {
  rows: {
    outcome: string;
    stage: string;
    category: string;
    browser: string;
    os: string;
    size_band: string;
    count: number;
    duration_ms: number;
  }[];
  totals: { outcome: string; count: number }[];
};
type Scan = {
  direction: string;
  scanned: number;
  items: { key: string; sizeBytes?: number; id?: string; kind?: string }[];
  nextCursor: string | null;
  skippedRecent?: number;
};
const time = (value: number | null) =>
  value ? new Date(value * 1000).toLocaleString() : "Not recorded yet";
const card = "rounded-xl border border-slate-200 bg-white p-4";
export default function AdminOperations({ isOwner }: { isOwner: boolean }) {
  const cache = useQueryClient();
  const toast = useToast();
  const health = useQuery({
    queryKey: ["operations-health"],
    queryFn: () => operationalRequest<Health>("/operations/health"),
    refetchInterval: 60000,
  });
  const diagnostics = useQuery({
    queryKey: ["operations-diagnostics"],
    queryFn: () => operationalRequest<Diagnostics>("/operations/diagnostics"),
    refetchInterval: 60000,
  });
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [diagnosticFilter, setDiagnosticFilter] = useState("all");
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["operations-health"] });
    void cache.invalidateQueries({ queryKey: ["operations-diagnostics"] });
  };
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    try {
      await operation();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function scanPage(direction: string, cursor?: string | null) {
    await run(async () => {
      setScan(
        await operationalRequest<Scan>(
          `/operations/reconciliation?direction=${direction}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      setConfirmation("");
    });
  }
  const totals = diagnostics.data?.totals ?? [];
  const successes = totals.find((r) => r.outcome === "success")?.count ?? 0;
  const failures = totals.find((r) => r.outcome === "failed")?.count ?? 0;
  const attempts = successes + failures;
  const lastSweep = health.data?.runs.find(
    (run) => run.name === "expiration-sweep",
  )?.last_success_at;
  const sweepOverdue =
    health.data &&
    (!lastSweep ||
      lastSweep < Date.now() / 1000 - health.data.thresholds.staleHours * 3600);
  return (
    <div className="space-y-5" data-ui="admin-operations">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Operations</h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload reliability, background jobs, and storage integrity.
          </p>
        </div>
        <button onClick={refresh} className="mini">
          Refresh
        </button>
      </div>
      {(health.error || diagnostics.error) && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {String((health.error || diagnostics.error)?.message)}. Verify the API
          deployment and database migration.
        </p>
      )}
      {(health.isPending || diagnostics.isPending) && (
        <p role="status">Loading operations…</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            "Upload success · 24h",
            attempts
              ? `${Math.round((successes / attempts) * 100)}%`
              : "No reports yet",
          ],
          ["Stuck uploads · >24h", health.data?.stuckUploads ?? "—"],
          [
            "Expired multipart sessions",
            health.data?.abandonedMultipart ?? "—",
          ],
          ["Preview failures · 24h", health.data?.thumbnailFailures ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className={card}>
            <p className="text-xs text-slate-600">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-800">
              {value}
            </p>
          </div>
        ))}
      </div>
      <section className={card}>
        <h4 className="font-semibold text-slate-800">System health</h4>
        <p className="mt-2 text-sm">
          Object storage:{" "}
          {health.data
            ? health.data.storageReachable
              ? "Reachable"
              : "Unreachable — inspect storage binding"
            : "Checking…"}
        </p>
        {sweepOverdue && (
          <p
            role="status"
            className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            Expiration cleanup has not reported a recent success. Check the
            scheduled Worker; this check remains visible even if the scheduler
            stops.
          </p>
        )}
        {health.data?.runs.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">
            No background runs recorded yet. The first scheduled run populates
            this panel.
          </p>
        )}
        {health.data?.runs.map((run) => (
          <div
            key={run.name}
            className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <b>{run.name.replace(/-/g, " ")}</b>
              <span
                className={
                  run.status === "error" ? "text-red-700" : "text-slate-600"
                }
              >
                {run.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Last success: {time(run.last_success_at)} ·{" "}
              {run.detail || "In progress"}
            </p>
          </div>
        ))}
        <p className="mt-3 text-xs text-slate-600">
          Stuck transfers: check upload diagnostics. Failed or overdue jobs:
          inspect Worker logs and Cron configuration. Preview failures leave
          originals intact.
        </p>
      </section>
      <section className={card}>
        <h4 className="font-semibold text-slate-800">
          Upload diagnostics · last 24 hours
        </h4>
        <p className="my-2 text-xs text-slate-600">
          Client-reported attempts; cancelled uploads are excluded from success
          rate. Browser interruptions may prevent reporting. Native photo-picker
          progress is unavailable. Reports are retained for 30 days.
        </p>
        <label className="text-sm">
          Outcome{" "}
          <select
            className="ml-2 rounded-lg border p-2"
            value={diagnosticFilter}
            onChange={(e) => setDiagnosticFilter(e.target.value)}
          >
            {["all", "success", "failed", "cancelled", "thumbnail-failed"].map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
        </label>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {[
                  "Outcome / stage",
                  "Browser / OS",
                  "Size",
                  "Count",
                  "Avg duration",
                ].map((x) => (
                  <th key={x} className="border-b p-2">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diagnostics.data?.rows
                .filter(
                  (row) =>
                    diagnosticFilter === "all" ||
                    row.outcome === diagnosticFilter,
                )
                .map((row, i) => (
                  <tr key={i}>
                    <td className="border-b p-2">
                      {row.outcome} · {row.stage}
                      <span className="block text-slate-500">
                        {row.category}
                      </span>
                    </td>
                    <td className="border-b p-2">
                      {row.browser} / {row.os}
                    </td>
                    <td className="border-b p-2">{row.size_band}</td>
                    <td className="border-b p-2">{row.count}</td>
                    <td className="border-b p-2">
                      {Math.round(row.duration_ms / 1000)}s
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {diagnostics.data?.rows.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            New uploads will populate this report.
          </p>
        )}
      </section>
      <section className={card}>
        <h4 className="font-semibold text-slate-800">Operational alerts</h4>
        <p className="mt-2 text-xs text-slate-600">
          Evaluated hourly. Repeated conditions update one alert; recovery
          resolves it automatically. Acknowledgment does not hide an ongoing
          condition.
        </p>
        {!health.data?.alerts.length && (
          <p className="mt-3 text-sm text-slate-500">No recorded alerts.</p>
        )}
        {health.data?.alerts.map((alert) => (
          <div
            key={alert.id}
            className="mt-3 rounded-lg border border-slate-200 p-3"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <b className="text-sm">{alert.label}</b>
              <span className="text-xs">
                {alert.status}
                {alert.acknowledged_at && alert.status === "open"
                  ? " · Acknowledged"
                  : ""}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{alert.detail}</p>
            {alert.resolved_at && (
              <p className="mt-1 text-xs">Resolved {time(alert.resolved_at)}</p>
            )}
            {isOwner && alert.status === "open" && !alert.acknowledged_at && (
              <button
                disabled={busy}
                className="mini mt-2"
                onClick={() =>
                  void run(async () => {
                    await operationalRequest(
                      `/operations/alerts/${alert.id}/acknowledge`,
                      {},
                    );
                    refresh();
                  })
                }
              >
                Acknowledge
              </button>
            )}
          </div>
        ))}
        {health.data && (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await operationalRequest(
                  "/operations/thresholds",
                  thresholds ?? health.data!.thresholds,
                );
                setThresholds(null);
                refresh();
                toast.success("Alert thresholds saved");
              });
            }}
          >
            {(
              [
                ["failurePercent", "Failure rate (%)"],
                ["minAttempts", "Minimum completed attempts"],
                ["staleHours", "Cleanup overdue (hours)"],
                ["storageGrowthGiB", "Storage growth (GiB / baseline day)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs text-slate-600">
                {label}
                <input
                  required
                  type="number"
                  min={
                    key === "storageGrowthGiB"
                      ? 0.1
                      : key === "staleHours"
                        ? 2
                        : 1
                  }
                  max={
                    key === "failurePercent"
                      ? 100
                      : key === "staleHours"
                        ? 168
                        : key === "minAttempts"
                          ? 10000
                          : 100000
                  }
                  step={key === "storageGrowthGiB" ? 0.1 : 1}
                  disabled={!isOwner}
                  value={(thresholds ?? health.data!.thresholds)[key]}
                  onChange={(e) =>
                    setThresholds({
                      ...(thresholds ?? health.data!.thresholds),
                      [key]: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2"
                />
              </label>
            ))}
            {isOwner && (
              <button disabled={busy} className="mini justify-self-start">
                Save alert thresholds
              </button>
            )}
          </form>
        )}
      </section>
      <section className={card}>
        <h4 className="font-semibold text-slate-800">Storage reconciliation</h4>
        <p className="mt-2 text-xs text-slate-600">
          Scan bounded pages for unreferenced objects or missing
          originals/versions. Recent objects have a 24-hour grace period.
          Scanning never deletes data; scheduled orphan scans also only report
          candidates.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => void scanPage("orphans")}
            className="mini"
          >
            Scan orphan objects
          </button>
          <button
            disabled={busy}
            onClick={() => void scanPage("missing")}
            className="mini"
          >
            Check missing files
          </button>
        </div>
        {scan && (
          <div className="mt-3 text-sm">
            <p>
              {scan.scanned} checked on this page · {scan.items.length} findings
              {scan.skippedRecent
                ? ` · ${scan.skippedRecent} recent objects skipped`
                : ""}
            </p>
            <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
              {scan.items.map((item) => (
                <li
                  key={item.key}
                  className="break-all rounded-lg bg-slate-50 p-2 text-xs"
                >
                  {item.key}
                  {item.sizeBytes != null
                    ? ` · ${formatBytes(item.sizeBytes)}`
                    : ""}
                  {item.kind ? ` · ${item.kind}` : ""}
                </li>
              ))}
            </ul>
            {scan.nextCursor ? (
              <button
                disabled={busy}
                className="mini mt-3"
                onClick={() => void scanPage(scan.direction, scan.nextCursor)}
              >
                Next page
              </button>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                End of scan. Findings above are for this page only.
              </p>
            )}
            {isOwner &&
              scan.direction === "orphans" &&
              scan.items.length > 0 && (
                <div className="mt-4 rounded-lg border border-red-200 p-3">
                  <p className="text-xs text-red-700">
                    Permanently delete the {scan.items.length} objects listed on
                    this page. References and age are rechecked before deletion.
                  </p>
                  <label className="mt-2 block text-xs">
                    Type DELETE REVIEWED ORPHANS
                    <input
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      className="mt-1 w-full rounded-lg border p-2"
                    />
                  </label>
                  <button
                    disabled={
                      busy || confirmation !== "DELETE REVIEWED ORPHANS"
                    }
                    className="mt-2 rounded-lg bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-50"
                    onClick={() =>
                      void run(async () => {
                        const result = await operationalRequest<{
                          deleted: number;
                          skipped: number;
                        }>("/operations/reconciliation/cleanup", {
                          keys: scan.items.map((item) => item.key),
                          confirmation,
                        });
                        setScan(null);
                        setConfirmation("");
                        toast.success(
                          `${result.deleted} deleted; ${result.skipped} skipped after recheck`,
                        );
                        refresh();
                      })
                    }
                  >
                    Delete reviewed objects
                  </button>
                </div>
              )}
          </div>
        )}
        {busy && (
          <p role="status" className="mt-2 text-xs">
            Working…
          </p>
        )}
      </section>
    </div>
  );
}
export function PolicyImpact({
  settings,
  onReady,
}: {
  settings: Record<string, string>;
  onReady: (ready: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["policy-impact", settings],
    queryFn: () =>
      operationalRequest<{
        impacts: {
          key: string;
          count: number | null;
          unit: string;
          effect: string;
        }[];
        asOf: number;
      }>("/admin/settings/impact", { settings }),
    retry: false,
  });
  useEffect(() => {
    onReady(query.isSuccess && !query.isFetching);
  }, [query.isSuccess, query.isFetching, onReady]);
  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <h4 className="text-sm font-semibold text-slate-800">
        Impact on this workspace
      </h4>
      {query.isPending ? (
        <p className="mt-2 text-xs">Calculating affected accounts and files…</p>
      ) : query.error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          Could not calculate impact.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        query.data?.impacts.map((item) => (
          <div key={item.key} className="mt-3 text-xs">
            <b>
              {item.key}:{" "}
              {item.count != null
                ? `${item.count} ${item.unit}`
                : "Behavior change"}
            </b>
            <p className="mt-1 text-slate-700">{item.effect}</p>
          </div>
        ))
      )}
      <p className="mt-3 text-xs text-slate-600">
        Counts are a preview, not a reservation. Activity can change before
        saving.
      </p>
    </section>
  );
}
export function UserSupport({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["user-support", id],
    queryFn: () =>
      operationalRequest<{
        sessions: {
          id: string;
          createdAt: number;
          updatedAt: number;
          expiresAt: number;
        }[];
        failures: {
          id: string;
          outcome: string;
          stage: string;
          category: string;
          browser: string;
          os: string;
          created_at: number;
        }[];
        actions: {
          id: string;
          action: string;
          actor_email: string;
          created_at: number;
        }[];
      }>(`/admin/users/${id}/support`),
  });
  if (query.isPending)
    return <p className="text-sm">Loading support timeline…</p>;
  if (query.error)
    return (
      <p role="alert" className="text-sm text-red-700">
        Support data unavailable.{" "}
        <button className="underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );
  const data = query.data!;
  const timeline = [
    ...data.failures.map((row) => ({
      id: row.id,
      at: row.created_at,
      title: `${row.outcome} · ${row.stage}`,
      detail: `${row.category} · ${row.browser} / ${row.os}`,
    })),
    ...data.actions.map((row) => ({
      id: row.id,
      at: row.created_at,
      title: row.action,
      detail: row.actor_email,
    })),
  ].sort((a, b) => b.at - a.at);
  return (
    <section className={card}>
      <h4 className="font-semibold text-slate-800">Support timeline</h4>
      <p className="mt-2 text-xs text-slate-600">
        Account permissions and quota are shown in this profile. Session tokens
        and file contents are never exposed here.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Active sessions ({data.sessions.length}
          {data.sessions.length === 50 ? "+" : ""})
        </summary>
        {data.sessions.map((session) => (
          <p key={session.id} className="mt-2 text-xs text-slate-600">
            Last active {time(session.updatedAt)} · Expires{" "}
            {time(session.expiresAt)}
          </p>
        ))}
      </details>
      <div className="mt-4 max-h-80 space-y-3 overflow-auto">
        {timeline.length ? (
          timeline.map((row) => (
            <div key={row.id} className="border-l-2 border-slate-200 pl-3">
              <p className="text-sm font-medium">{row.title}</p>
              <p className="mt-1 text-xs text-slate-600">
                {time(row.at)} · {row.detail}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">
            No recent failures or account actions.
          </p>
        )}
      </div>
    </section>
  );
}
