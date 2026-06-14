import { useMemo, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { LogOut, HardDrive, Files as FilesIcon, Clock3 } from "lucide-react"
import { listFiles, extendFile, deleteFile, createShare, revokeShare } from "../lib/api"
import { signOut } from "../lib/auth-client"
import { formatBytes } from "../lib/format"
import Logo from "./Logo"
import UploadZone from "./UploadZone"
import FileCard from "./FileCard"

const headerInitial = { opacity: 0, y: -10 }
const headerAnimate = { opacity: 1, y: 0 }
const gridStagger = { visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30]

export default function Dashboard({ userName }: { userName?: string }) {
  const qc = useQueryClient()
  const [expiryDays, setExpiryDays] = useState(7)

  const filesQuery = useQuery({ queryKey: ["files"], queryFn: listFiles })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["files"] })

  const extendMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => extendFile(id, days),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: invalidate,
  })
  const shareMut = useMutation({
    mutationFn: (id: string) => createShare(id),
    onSuccess: invalidate,
  })
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: invalidate,
  })

  const files = filesQuery.data ?? []
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.sizeBytes || 0), 0), [files])

  return (
    <div className="relative">
      <motion.header
        initial={headerInitial}
        animate={headerAnimate}
        className="sticky top-0 z-20 border-b border-white/5 bg-ink/60 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            {userName && <span className="hidden text-white/50 sm:inline">Hi, {userName.split(" ")[0]}</span>}
            <button
              onClick={() => signOut()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </motion.header>

      <main