import { useMemo } from "react";
import type { DriftFile } from "../lib/api";
import { formatBytes } from "../lib/format";

type Cat = { key: string; label: string; bar: string; dot: string };
const CATS: Cat[] = [
  {
    key: "images",
    label: "Images",
    bar: "bg-emerald-400",
    dot: "bg-emerald-400",
  },
  { key: "videos", label: "Videos", bar: "bg-rose-400", dot: "bg-rose-400" },
  { key: "audio", label: "Audio", bar: "bg-violet-400", dot: "bg-violet-400" },
  { key: "docs", label: "Documents", bar: "bg-drift-400", dot: "bg-drift-400" },
  {
    key: "archives",
    label: "Archives",
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  { key: "other", label: "Other", bar: "bg-slate-300", dot: "bg-slate-300" },
];
function catOf(type: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.startsWith("image/")) return "images";
  if (t.startsWith("video/")) return "videos";
  if (t.startsWith("audio/")) return "audio";
  if (
    t.includes("zip") ||
    t.includes("compressed") ||
    t.includes("tar") ||
    t.includes("rar") ||
    t.includes("7z")
  )
    return "archives";
  if (
    t.includes("pdf") ||
    t.includes("word") ||
    t.includes("officedocument") ||
    t.includes("spreadsheet") ||
    t.includes("presentation") ||
    t.startsWith("text/") ||
    t.includes("rtf") ||
    t.includes("csv")
  )
    return "docs";
  return "other";
}

// Compact visual breakdown of storage usage by file category. Frontend-only —
// derived from the already-loaded file list.
export default function StorageBreakdown({ files }: { files: DriftFile[] }) {
  const { rows, total } = useMemo(() => {
    const bytes = new Map<string, number>();
    const counts = new Map<string, number>();
    let total = 0;
    for (const f of files) {
      const c = catOf(f.contentType);
      const b = f.sizeBytes || 0;
      bytes.set(c, (bytes.get(c) ?? 0) + b);
      counts.set(c, (counts.get(c) ?? 0) + 1);
      total += b;
    }
    const rows = CATS.map((cat) => ({
      ...cat,
      bytes: bytes.get(cat.key) ?? 0,
      count: counts.get(cat.key) ?? 0,
    }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.bytes - a.bytes);
    return { rows, total };
  }, [files]);

  if (total === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 drive-shadow">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Storage breakdown
        </h3>
        <span className="text-xs text-slate-400">
          {formatBytes(total)} total
        </span>
      </div>
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {rows.map((r) => (
          <div
            key={r.key}
            className={r.bar}
            style={{ width: `${(r.bytes / total) * 100}%` }}
            title={`${r.label}: ${formatBytes(r.bytes)}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + r.dot} />
            <span className="text-slate-600">{r.label}</span>
            <span className="ml-auto text-slate-400">
              {formatBytes(r.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
