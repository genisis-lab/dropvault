import { motion } from "framer-motion";
import { Users } from "lucide-react";
import type { DriftFile } from "../lib/api";
import { inlineUrl } from "../lib/api";
import { isEndToEndEncrypted } from "../lib/encryption";
import { fileKind } from "../lib/fileKind";
import { formatBytes } from "../lib/format";

// "Suggested" shelf of recently added files on the Calm home, styled like
// Drive's suggested files. Clicking a card opens the slide-in detail panel.
export default function RecentStrip({
  files,
  onOpen,
}: {
  files: DriftFile[];
  onOpen: (file: DriftFile) => void;
}) {
  if (files.length === 0) return null;
  return (
    <section aria-labelledby="recent-files-heading">
      <h2
        id="recent-files-heading"
        className="mb-3 px-1 text-base font-medium text-strong"
      >
        Recent
      </h2>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {files.map((f) => {
          const { Icon, tint } = fileKind(f.contentType);
          const isImage =
            !isEndToEndEncrypted(f) &&
            (f.contentType || "").startsWith("image/");
          return (
            <motion.button
              layout
              key={f.id}
              onClick={() => onOpen(f)}
              className="flex w-52 shrink-0 flex-col rounded-xl bg-slate-100 px-1 pb-1 text-left transition-colors hover:bg-[rgb(var(--c-strong)/0.1)]"
            >
              <span className="flex h-11 items-center gap-2 px-2.5">
                <Icon size={16} className={"shrink-0 " + tint} />
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium text-strong"
                  title={f.filename}
                >
                  {f.filename}
                </span>
              </span>
              <span className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-white">
                {isImage ? (
                  <img
                    src={inlineUrl(f.id)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Icon size={44} strokeWidth={1.4} className={tint} />
                )}
              </span>
              <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted">
                {f.shareToken && <Users size={12} aria-label="Shared" />}
                {formatBytes(f.sizeBytes)}
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
