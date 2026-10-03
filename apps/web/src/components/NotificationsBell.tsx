import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../lib/api";
import {
  notificationDestination,
  type NotificationDestination,
} from "../lib/notificationTarget";

const popInitial = { opacity: 0, scale: 0.96, y: 8 };
const popAnimate = { opacity: 1, scale: 1, y: 0 };
const popExit = { opacity: 0, scale: 0.96, y: 8 };
function when(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsBell({
  onNavigate,
}: {
  onNavigate?: (destination: NotificationDestination) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 60000,
  });
  const notifications = q.data ?? [];
  const unread = notifications.filter((n) => !n.readAt).length;
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["notifications"] });
  const readMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
  });
  const readAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
  });
  const delMut = useMutation({
    mutationFn: deleteNotification,
    onSuccess: invalidate,
  });
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={popInitial}
              animate={popAnimate}
              exit={popExit}
              className="absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[28px] bg-menu drive-shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-xl font-normal text-strong">
                    Notifications
                  </h2>
                  <p className="text-xs text-slate-400">{unread} unread</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    title="Mark all read"
                    onClick={() => readAllMut.mutate()}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                  >
                    <CheckCheck size={16} />
                  </button>
                  <button
                    title="Close"
                    onClick={() => setOpen(false)}
                    className="icon-round"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                {q.isLoading ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Loading…
                  </p>
                ) : notifications.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No notifications yet.
                  </p>
                ) : (
                  notifications.map((n: NotificationItem) => (
                    <div
                      key={n.id}
                      className={
                        "group rounded-xl px-3 py-2.5 " +
                        (!n.readAt ? "bg-drift-50/70" : "hover:bg-slate-50")
                      }
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => {
                            if (!n.readAt) readMut.mutate(n.id);
                            const destination = notificationDestination(n);
                            if (destination && onNavigate) {
                              setOpen(false);
                              onNavigate(destination);
                            }
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {n.title}
                          </p>
                          {n.message && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                              {n.message}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-400">
                            {when(n.createdAt)}
                          </p>
                        </button>
                        <button
                          title="Delete"
                          onClick={() => delMut.mutate(n.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
