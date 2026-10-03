import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEscapeToClose } from "../lib/useEscapeToClose";
import {
  Check,
  Clock,
  Download,
  Infinity as InfinityIcon,
  KeyRound,
  Link2,
  LockKeyhole,
  Star,
  Tags,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { DriftFile } from "../lib/api";
import { downloadUrl, inlineUrl, shareUrlForFile } from "../lib/api";
import { formatBytes, timeLeft } from "../lib/format";
import {
  downloadDecryptedFile,
  isEndToEndEncrypted,
} from "../lib/encryption";
import { copyTextFrom } from "../lib/clipboard";
import { useToast } from "./Toast";
import VaultRecoveryDialog from "./VaultRecoveryDialog";
import { fileKind } from "../lib/fileKind";

type Props = {
  file: DriftFile | null;
  onClose: () => void;
  onShare: (id: string) => Promise<string>;
  onRevoke: (id: string) => void;
  onPreview: (file: DriftFile) => void;
  onToggleFavorite: (id: string) => void;
  onEditTags: (id: string) => void;
  onExtend: (id: string, days: number) => void;
  onDelete: (id: string) => void;
  canKeepForever?: boolean;
  onKeepForever?: (id: string) => void;
  onUnkeepForever?: (id: string) => void;
};

const panelInitial = { x: "100%" };
const panelAnimate = { x: 0 };
const overlayInitial = { opacity: 0 };
const overlayAnimate = { opacity: 1 };
const panelTransition = { type: "tween", duration: 0.22 } as const;

// Slide-in right-side detail panel used by the Calm start page. Shows a preview,
// share status, expiry, tags, and quick actions for a single file.
export default function DetailPanel(props: Props) {
  const { file, onClose } = props;
  useEscapeToClose(!!file, onClose);
  return (
    <AnimatePresence>
      {file && (
        <div className="fixed inset-0 z-40">
          <motion.button
            initial={overlayInitial}
            animate={overlayAnimate}
            exit={overlayInitial}
            aria-label="Close details"
            onClick={onClose}
            className="absolute inset-0 bg-black/40 md:bg-black/10"
            data-ui="detail-overlay"
          />
          <motion.aside
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelInitial}
            transition={panelTransition}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-sheet drive-shadow-lg md:inset-y-2 md:right-2 md:rounded-2xl"
            data-ui="detail-panel"
          >
            <DetailBody key={file.id} {...props} file={file} />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function DetailBody({
  file,
  onClose,
  onShare,
  onRevoke,
  onPreview,
  onToggleFavorite,
  onEditTags,
  onExtend,
  onDelete,
  canKeepForever = false,
  onKeepForever,
  onUnkeepForever,
}: Props & { file: DriftFile }) {
  const { error } = useToast();
  const { Icon, tint: tone } = fileKind(file.contentType);
  const encrypted = isEndToEndEncrypted(file);
  const isImage =
    !encrypted && (file.contentType || "").startsWith("image/");
  const canPreview =
    !encrypted && (isImage || (file.contentType || "").includes("pdf"));
  const left = timeLeft(file.expiresAt);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const created = new Date(file.createdAt * 1000).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );
  const tags = file.tags ?? [];

  async function copyLink() {
    setBusy(true);
    try {
      const { result } = await copyTextFrom(async () =>
        ((file.shareToken ? await shareUrlForFile(file) : null) ??
          (await onShare(file.id))),
      );
      if (result === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch (e) {
      error((e as Error)?.message || "Couldn't copy the link");
    } finally {
      setBusy(false);
    }
  }

  const action =
    "btn-outlined !min-h-9 !justify-start !px-4 !text-strong [&>svg]:text-muted";
  return (
    <>
      <div className="flex items-center gap-3 py-3 pl-5 pr-2">
        <Icon size={20} className={"shrink-0 " + tone} aria-hidden="true" />
        <h2
          className="min-w-0 flex-1 truncate text-base font-normal text-strong"
          title={file.filename}
        >
          {file.filename}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-round"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <button
          type="button"
          onClick={() => canPreview && onPreview(file)}
          className={
            "flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100" +
            (canPreview ? " cursor-zoom-in" : " cursor-default")
          }
          aria-label={canPreview ? `Preview ${file.filename}` : undefined}
        >
          {isImage ? (
            <img
              src={inlineUrl(file.id)}
              alt={file.filename}
              className="h-full w-full object-cover"
            />
          ) : (
            <Icon size={64} strokeWidth={1.3} className={tone} />
          )}
        </button>
        {downloadError && (
          <p className="mt-2 text-xs text-red-700">{downloadError}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={copyLink}
            className="btn-filled !min-h-9 !px-4"
          >
            {copied ? <Check size={16} /> : <Link2 size={16} />}{" "}
            {file.shareToken ? "Copy link" : "Get link"}
          </button>
          {file.encryptionMode === "aes-gcm" ? (
            <button
              onClick={() => {
                setDownloadError(null);
                downloadDecryptedFile(file, downloadUrl(file.id)).catch(
                  (error) => setDownloadError((error as Error).message),
                );
              }}
              className={action}
            >
              <Download size={16} /> Decrypt
            </button>
          ) : (
            <a href={downloadUrl(file.id)} className={action}>
              <Download size={16} /> Download
            </a>
          )}
          <button onClick={() => onToggleFavorite(file.id)} className={action}>
            <Star
              size={16}
              className={file.favorite ? "fill-current !text-[#f9ab00]" : ""}
            />{" "}
            {file.favorite ? "Unfavorite" : "Favorite"}
          </button>
          <button onClick={() => onEditTags(file.id)} className={action}>
            <Tags size={16} /> Tags
          </button>
          {!file.keepForever && (
            <button onClick={() => onExtend(file.id, 7)} className={action}>
              <Clock size={16} /> +7 days
            </button>
          )}
          {!file.deletedAt &&
            (file.keepForever ? (
              <button
                onClick={() => onUnkeepForever?.(file.id)}
                className={action}
              >
                <Clock size={16} /> Stop keeping forever
              </button>
            ) : canKeepForever ? (
              <button
                onClick={() => onKeepForever?.(file.id)}
                className={action}
              >
                <InfinityIcon size={16} /> Keep forever
              </button>
            ) : null)}
          {file.encryptionMode === "aes-gcm" && (
            <button onClick={() => setRecoveryOpen(true)} className={action}>
              <LockKeyhole size={16} /> Recovery
            </button>
          )}
          {file.encryptionMode === "aes-gcm" && (
            <button
              onClick={() => {
                setDownloadError(null);
                downloadDecryptedFile(file, downloadUrl(file.id), {
                  forcePassword: true,
                }).catch((downloadCause) =>
                  setDownloadError((downloadCause as Error).message),
                );
              }}
              className={action}
            >
              <KeyRound size={16} /> Use password
            </button>
          )}
          {file.shareToken && (
            <button onClick={() => onRevoke(file.id)} className={action}>
              <X size={16} /> Revoke share link
            </button>
          )}
          <button
            onClick={() => {
              onDelete(file.id);
              onClose();
            }}
            className={action}
          >
            <Trash2 size={16} /> Trash
          </button>
        </div>

        <h3 className="mt-6 text-sm font-medium text-strong">
          Who has access
        </h3>
        <p className="mt-2 flex items-center gap-3 text-sm text-muted">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100">
            {file.shareToken ? <Users size={16} /> : <LockKeyhole size={16} />}
          </span>
          {file.shareToken ? (
            <span>
              <span className="block text-strong">Shared</span>
              Anyone with the link can view
            </span>
          ) : (
            <span>
              <span className="block text-strong">Private</span>
              Only you can open this file
            </span>
          )}
        </p>

        <h3 className="mt-6 text-sm font-medium text-strong">File details</h3>
        <dl className="mt-2 space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Type</dt>
            <dd className="text-strong">{file.contentType || "File"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Size</dt>
            <dd className="text-strong">{formatBytes(file.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Expiry</dt>
            <dd
              className={
                file.keepForever && !file.deletedAt
                  ? "text-strong"
                  : left.urgent
                    ? "font-medium text-red-700"
                    : "text-strong"
              }
            >
              <span className="inline-flex items-center gap-1">
                {file.keepForever && !file.deletedAt ? (
                  <InfinityIcon size={14} />
                ) : (
                  <Clock size={14} />
                )}{" "}
                {file.deletedAt
                  ? "In Trash"
                  : file.keepForever
                    ? "Forever"
                    : left.label}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Added</dt>
            <dd className="text-strong">{created}</dd>
          </div>
          {file.encryptionMode === "aes-gcm" && (
            <div>
              <dt className="text-xs text-muted">Encryption</dt>
              <dd className="inline-flex items-center gap-1 text-strong">
                <LockKeyhole size={14} /> Encrypted in your browser
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted">Tags</dt>
            <dd>
              {tags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs text-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-faint">No tags yet</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <VaultRecoveryDialog
        file={file}
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
      />
    </>
  );
}
