import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  Check,
  Copy,
  Eye,
  Hash,
  Image as ImageIcon,
  Link2,
  Lock,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import {
  createShare,
  fileShareEvents,
  revokeShare,
  shareUrlForFile,
  type DriftFile,
  type ShareEvent,
} from "../lib/api";
import { copyText, copyTextFrom } from "../lib/clipboard";
import { useToast } from "./Toast";

const EXPIRY_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: "No expiry (until file expires)" },
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
];

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.96, y: 10 };
const panelAnimate = { opacity: 1, scale: 1, y: 0 };
const panelExit = { opacity: 0, scale: 0.96, y: 10 };
function linesToList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function when(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ShareDialog({
  file,
  onClose,
  onChanged,
}: {
  file: DriftFile | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { success, error } = useToast();
  const isImage = !!file?.contentType?.startsWith("image/");
  const [password, setPassword] = useState("");
  const [limit, setLimit] = useState(
    file?.shareDownloadLimit ? String(file.shareDownloadLimit) : "",
  );
  const [expiry, setExpiry] = useState(0);
  const [accessMode, setAccessMode] = useState<
    "download" | "preview" | "disabled"
  >(file?.shareAccessMode ?? "download");
  const [oneTime, setOneTime] = useState(!!file?.shareOneTime);
  const [embed, setEmbed] = useState(file?.shareEmbed !== false);
  const [allowlist, setAllowlist] = useState("");
  const [ipAllowlist, setIpAllowlist] = useState("");
  const [countryAllowlist, setCountryAllowlist] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [analytics, setAnalytics] = useState<{
    events: ShareEvent[];
    summary: Record<string, number>;
  } | null>(null);
  const hasLink = !!url;

  useEffect(() => {
    if (!file?.id || !file.shareToken) return;
    shareUrlForFile(file)
      .then(setUrl)
      .catch(() => {});
    fileShareEvents(file.id)
      .then(setAnalytics)
      .catch(() => {});
  }, [file?.id, file?.shareToken]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const sharePromise = createShare(file.id, {
        password: password.trim() ? password.trim() : null,
        downloadLimit: limit.trim()
          ? Math.max(1, Math.floor(Number(limit)))
          : null,
        expiresInDays: expiry || null,
        accessMode,
        oneTime,
        embed,
        allowlist: linesToList(allowlist),
        ipAllowlist: linesToList(ipAllowlist),
        countryAllowlist: linesToList(countryAllowlist),
      });
      const { result: copyResult } = await copyTextFrom(() =>
        sharePromise.then((result) => result.url),
      );
      const res = await sharePromise;
      setUrl(res.url);
      const autoCopied = copyResult === "copied";
      if (autoCopied) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
      success(autoCopied ? "Share link ready & copied" : "Share link ready");
      onChanged();
      fileShareEvents(file.id)
        .then(setAnalytics)
        .catch(() => {});
    } catch (e) {
      error((e as Error)?.message || "Couldn't create link");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      error((e as Error)?.message || "Couldn't copy the link");
    }
  }
  async function revoke() {
    if (!file) return;
    setBusy(true);
    try {
      await revokeShare(file.id);
      success("Link revoked");
      onChanged();
      onClose();
    } catch (e) {
      error((e as Error)?.message || "Couldn't revoke link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600">
                  <Link2 size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">
                    Share file
                  </h2>
                  <p
                    className="truncate text-xs text-slate-400"
                    title={file.filename}
                  >
                    {file.filename}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-4">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Eye size={13} /> Access mode
                </span>
                <select
                  value={accessMode}
                  onChange={(e) =>
                    setAccessMode(e.target.value as typeof accessMode)
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                >
                  <option value="download">Preview and download</option>
                  <option value="preview">Preview only</option>
                  <option value="disabled">Disabled / paused</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Lock size={13} /> Password{" "}
                    <span className="text-slate-400">optional</span>
                  </span>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      file.shareHasPassword
                        ? "Set — type to change"
                        : "No password"
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Hash size={13} /> Download limit
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="Unlimited"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarClock size={13} /> Link expires
                  </span>
                  <select
                    value={expiry}
                    onChange={(e) => setExpiry(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                  >
                    {EXPIRY_CHOICES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-end gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={oneTime}
                    onChange={(e) => setOneTime(e.target.checked)}
                    className="mb-1"
                  />{" "}
                  One-time link
                </label>
              </div>
              {isImage && (
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={embed}
                    onChange={(e) => setEmbed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <ImageIcon size={14} /> Show the image when the link is
                      opened
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                      The picture appears right away on the link page — no need
                      to click Preview — and a preview thumbnail shows up when
                      you paste the link into chat apps like Slack, iMessage, or
                      WhatsApp. Turn this off to share a plain download link
                      with no image preview.{" "}
                      {file.shareHasPassword
                        ? "Password-protected links always stay hidden behind the password."
                        : ""}
                    </span>
                  </span>
                </label>
              )}
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                  <Shield size={15} /> Advanced restrictions
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Allowed emails
                    </span>
                    <textarea
                      value={allowlist}
                      onChange={(e) => setAllowlist(e.target.value)}
                      placeholder="one@example.com, two@example.com"
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Allowed IP addresses
                    </span>
                    <textarea
                      value={ipAllowlist}
                      onChange={(e) => setIpAllowlist(e.target.value)}
                      placeholder="203.0.113.10"
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Allowed countries
                    </span>
                    <input
                      value={countryAllowlist}
                      onChange={(e) =>
                        setCountryAllowlist(e.target.value.toUpperCase())
                      }
                      placeholder="US, CA"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                    />
                  </label>
                </div>
              </details>
              {url && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={url}
                      className="min-w-0 flex-1 bg-transparent px-1 text-xs text-slate-600 outline-none"
                    />
                    <button
                      onClick={copy}
                      className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-drift-600 ring-1 ring-slate-200 hover:bg-drift-50"
                    >
                      {copied ? (
                        <Check size={13} className="text-emerald-500" />
                      ) : (
                        <Copy size={13} />
                      )}{" "}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
              {analytics && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <BarChart3 size={15} /> Link analytics
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <b className="block text-base text-slate-800">
                        {analytics.summary.view ?? 0}
                      </b>
                      Views
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <b className="block text-base text-slate-800">
                        {analytics.summary.preview ?? 0}
                      </b>
                      Previews
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <b className="block text-base text-slate-800">
                        {analytics.summary.download ?? 0}
                      </b>
                      Downloads
                    </div>
                  </div>
                  {analytics.events.length > 0 && (
                    <div className="mt-2 max-h-24 overflow-y-auto text-xs text-slate-500">
                      {analytics.events.slice(0, 8).map((ev) => (
                        <div
                          key={ev.id}
                          className="flex justify-between gap-2 border-t border-slate-100 py-1"
                        >
                          <span>{ev.event}</span>
                          <span>{when(ev.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
              {hasLink ? (
                <button
                  onClick={revoke}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Revoke
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={submit}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-60"
              >
                <Link2 size={15} /> {hasLink ? "Update link" : "Create link"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
