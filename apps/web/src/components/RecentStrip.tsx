import { motion } from "framer-motion";
import {
  Archive,
  Clock,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Music,
} from "lucide-react";
import type { DriftFile } from "../lib/api";
import { inlineUrl } from "../lib/api";
import { isEndToEndEncrypted } from "../lib/encryption";
import { formatBytes } from "../lib/format";

type Tint = "indigo" | "emerald" | "rose" | "violet" | "red" | "amber";
const TINT: Record<Tint, { bg: string; fg: string }> = {
  indigo: { bg: "bg-indigo-50", fg: "text-indigo-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-500" },
  rose: { bg: "bg-rose-50", fg: "text-rose-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-500" },
  red: { bg: "bg-red-50", fg: "text-red-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-500" },
};
function kindOf(type: string | null): { Icon: typeof FileText; tint: Tint } {
  if (!type) return { Icon: FileText, tint: "indigo" };
  if (type.startsWith("image/")) return { Icon: ImageIcon, tint: "emerald" };
  if (type.startsWith("video/")) return { Icon: Film, tint: "rose" };
  if (type.startsWith("audio/")) return { Icon: Music, tint: "violet" };
  if (type.includes("pdf")) return { Icon: FileText, tint: "red" };
  if (
    type.includes("zip") ||
    type.includes("compressed") ||
    type.includes("tar")
  )
    return { Icon: Archive, tint: "amber" };
  return { Icon: FileText, tint: "indigo" };
}

// Horizontally scrolling shelf of recently added files, shown on the Calm
// Workspace home. Clicking a card opens the slide-in detail panel.
export default function RecentStrip({
  files,
  onOpen,
}: {
  files: DriftFile[];
  onOpen: (file: DriftFile) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Recent
      </h2>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {files.map((f) => {
          const { Icon, tint } = kindOf(f.contentType);
          const tone = TINT[tint];
          const isImage =
            !isEndToEndEncrypted(f) &&
            (f.contentType || "").startsWith("image/");
          return (
            <motion.button
              layout
              key={f.id}
              onClick={() => onOpen(f)}
              className="group flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left drive-shadow transition hover:border-slate-300 hover:shadow-md"
            >
              <div
                className={
                  "relative flex h-20 items-center justify-center overflow-hidden " +
                  tone.bg
                }
              >
                {isImage ? (
                  <img
                    src={inlineUrl(f.id)}
                    alt={f.filename}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Icon size={28} className={tone.fg} />
                )}
                {f.shareToken && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-drift-500">
                    <Link2 size={11} />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <div
                  className={
                    "grid h-6 w-6 shrink-0 place-items-center rounded-md " +
                    tone.bg +
                    " " +
                    tone.fg
                  }
                >
                  <Icon size={13} />
                </div>
                <p
                  className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800"
                  title={f.filename}
                >
                  {f.filename}
                </p>
              </div>
              <div className="flex items-center gap-1 px-3 pb-2 text-[11px] text-slate-400">
                <Clock size={10} /> {formatBytes(f.sizeBytes)}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
