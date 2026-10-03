import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEscapeToClose } from "../lib/useEscapeToClose";
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
import { copyTextFrom } from "../lib/clipboard";
import { useToast } from "./Toast";

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
  const { error } = useToast();
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
      const { result } = await copyTextFrom(async () =>
        folder.shareToken
          ? folderShareUrl(folder.shareToken)
          : await onShare(folder.id),
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
  const row = "menu-item rounded-full";
  return (
    <>
      <div className="flex items-center justify-between py-3 pl-5 pr-2">
        <h2 className="text-base font-normal text-strong">Folder details</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-round"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col items-center gap-3 border-b border-slate-200 pb-5 text-center">
          <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-slate-100 text-[#5f6368] dark:text-[#c4c7c5]">
            <Folder size={64} strokeWidth={1.3} className="fill-current" />
          </div>
          <div className="min-w-0">
            <p
              className="truncate text-base text-strong"
              title={folder.name}
            >
              {folder.name}
            </p>
            <p className="text-xs text-slate-400">
              {folder.itemCount ?? folder.fileCount} item
              {(folder.itemCount ?? folder.fileCount) === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <dl className="space-y-2.5 border-b border-slate-200 py-4 text-sm">
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
        <div className="border-b border-slate-200 py-4">
          <p className="text-sm font-medium text-strong">
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
              className="mt-1 drive-field"
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
            className="btn-filled mt-3 !min-h-9 !px-4"
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
            <FolderOpen size={18} /> Open folder
          </button>
          <button disabled={busy} onClick={copyLink} className={row}>
            {copied ? (
              <Check size={18} className="text-emerald-500" />
            ) : (
              <Link2 size={18} />
            )}{" "}
            {shared ? "Copy link" : "Get link"}
          </button>
          <button onClick={() => onOpenShare(folder.id)} className={row}>
            <SlidersHorizontal size={18} /> Share settings
          </button>
          {shared && (
            <a
              href={folderShareUrl(folder.shareToken as string)}
              target="_blank"
              rel="noreferrer"
              className={row}
            >
              <Download size={18} /> Open public view
            </a>
          )}
          {shared && (
            <button onClick={() => onRevoke(folder.id)} className={row}>
              <X size={18} /> Revoke link
            </button>
          )}
          <button onClick={() => onRename(folder.id)} className={row}>
            <Pencil size={18} /> Rename
          </button>
          <button
            onClick={() => {
              onDelete(folder.id);
              onClose();
            }}
            className="menu-item rounded-full"
          >
            <Trash2 size={18} /> Delete folder
          </button>
        </div>
      </div>
    </>
  );
}

export default function FolderDetailPanel(props: Props) {
  const { folder, onClose } = props;
  useEscapeToClose(!!folder, onClose);
  return (
    <AnimatePresence>
      {folder && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[65] bg-black/40"
        >
          <motion.aside
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelInitial}
            transition={panelTransition}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-sheet drive-shadow-lg md:inset-y-2 md:right-2 md:rounded-2xl"
          >
            <Body {...props} folder={folder} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
