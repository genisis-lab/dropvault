import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Check,
  Download,
  Folder,
  FolderOpen,
  Hash,
  Link2,
  Lock,
  Pencil,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { folderShareUrl, type Folder as FolderT } from "../lib/api";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { x: "100%" };
const panelAnimate = { x: 0 };
const panelTransition = { type: "tween", duration: 0.24 } as const;

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type Props = {
  folder: FolderT | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onShare: (id: string) => Promise<string>;
  onRevoke: (id: string) => void;
  onOpenShare: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveAutomation: (
    id: string,
    input: { defaultExpiryDays: number | null; expireAfterDownload: boolean },
  ) => Promise<void>;
};

function Body({
  folder,
  onClose,
  onOpen,
  onShare,
  onRevoke,
  onOpenShare,
  onRename,
  onDelete,
  onSaveAutomation,
}: Props & { folder: FolderT }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const shared = !!folder.shareToken;
  const [defaultDays, setDefaultDays] = useState(
    folder.defaultExpiryDays ? String(folder.defaultExpiryDays) : "",
  );
  const [afterDownload, setAfterDownload] = useState(
    !!folder.expireAfterDownload,
  );
  const [automationSaved, setAutomationSaved] = useState(false);
  async function copyLink() {
    setBusy(true);
    try {
      const url = folder.shareToken
        ? folderShareUrl(folder.shareToken)
        : await onShare(folder.id);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const row =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50";
  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <h2 className="text-sm font-semibold text-slate-800">Folder details</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-center gap-3 border-b border-slate-100 pb-5 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-500">
            <Folder size={30} />
          </div>
          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold text-slate-800"
              title={folder.name}
            >
              {folder.name}
            </p>
            <p className="text-xs text-slate-400">
              {folder.fileCount} item{folder.fileCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <dl className="space-y-2.5 border-b border-slate-100 py-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Created</dt>
            <dd className="text-slate-600">{when(folder.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">Sharing</dt>
            <dd className="text-slate-600">
              {shared ? "Public link" : "Private"}
            </dd>
          </div>
          {shared && (
            <>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <Lock size={13} /> Password
                </dt>
                <dd className="text-slate-600">
                  {folder.shareHasPassword ? "On" : "Off"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <Hash size={13} /> Downloads
                </dt>
                <dd className="text-slate-600">
                  {folder.shareDownloadCount ?? 0}
                  {folder.shareDownloadLimit
                    ? ` / ${folder.shareDownloadLimit}`
                    : ""}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <CalendarClock size={13} /> Link expires
                </dt>
                <dd className="text-slate-600">
                  {folder.shareExpiresAt
                    ? when(folder.shareExpiresAt)
                    : "Never"}
                </dd>
              </div>
            </>
          )}
        </dl>
        <div className="border-b border-slate-100 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Upload automation
          </p>
          <label className="mt-2 block text-xs text-slate-500">
            Default expiry days
            <input
              type="number"
              min={1}
              max={3650}
              value={defaultDays}
              onChange={(e) => setDefaultDays(e.target.value)}
              placeholder="Use workspace default"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={afterDownload}
              onChange={(e) => setAfterDownload(e.target.checked)}
            />{" "}
            Expire new files after their first download
          </label>
          <button
            onClick={async () => {
              await onSaveAutomation(folder.id, {
                defaultExpiryDays: defaultDays ? Number(defaultDays) : null,
                expireAfterDownload: afterDownload,
              });
              setAutomationSaved(true);
              setTimeout(() => setAutomationSaved(false), 1600);
            }}
            className="mt-2 rounded-lg bg-drift-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-drift-600"
          >
            {automationSaved ? "Saved" : "Save automation"}
          </button>
        </div>
        <div className="space-y-0.5 pt-3">
          <button
            onClick={() => {
              onOpen(folder.id);
              onClose();
            }}
            className={row}
          >
            <FolderOpen size={15} /> Open folder
          </button>
          <button disabled={busy} onClick={copyLink} className={row}>
            {copied ? (
              <Check size={15} className="text-emerald-500" />
            ) : (
              <Link2 size={15} />
            )}{" "}
            {shared ? "Copy link" : "Get link"}
          </button>
          <button onClick={() => onOpenShare(folder.id)} className={row}>
            <SlidersHorizontal size={15} /> Share settings
          </button>
          {shared && (
            <a
              href={folderShareUrl(folder.shareToken as string)}
              target="_blank"
              rel="noreferrer"
              className={row}
            >
              <Download size={15} /> Open public view
            </a>
          )}
          {shared && (
            <button onClick={() => onRevoke(folder.id)} className={row}>
              <X size={15} /> Revoke link
            </button>
          )}
          <button onClick={() => onRename(folder.id)} className={row}>
            <Pencil size={15} /> Rename
          </button>
          <button
            onClick={() => {
              onDelete(folder.id);
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
          >
            <Trash2 size={15} /> Delete folder
          </button>
        </div>
      </div>
    </>
  );
}

export default function FolderDetailPanel(props: Props) {
  const { folder, onClose } = props;
  return (
    <AnimatePresence>
      {folder && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[65] bg-slate-900/30 backdrop-blur-sm"
        >
          <motion.aside
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelInitial}
            transition={panelTransition}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white drive-shadow-lg"
          >
            <Body {...props} folder={folder} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
