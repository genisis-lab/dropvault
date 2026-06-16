const API = import.meta.env.VITE_API_URL ?? ""

type AdminRole = "owner" | "admin" | "moderator" | "viewer" | string | null

type AdminUser = {
  id: string
  name: string
  email: string
  role?: AdminRole
  keepFilesForever?: boolean
  keepFilesForeverGranted?: boolean
}

type UsersResponse = { users: AdminUser[] }

let userCache: AdminUser[] | null = null
let userCacheAt = 0
let busy = false
const CACHE_MS = 15_000
const ROLE_DEFAULTS = new Set(["owner", "admin", "moderator"])

function canRun() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

async function loadUsers(force = false): Promise<AdminUser[]> {
  const now = Date.now()
  if (!force && userCache && now - userCacheAt < CACHE_MS) return userCache
  const data = await json<UsersResponse>(await fetch(`${API}/api/admin/users`, { credentials: "include" }))
  userCache = data.users ?? []
  userCacheAt = now
  return userCache
}

function text(el: Element | null | undefined) {
  return (el?.textContent ?? "").trim()
}

function findProfileEmail(): string | null {
  const backButton = Array.from(document.querySelectorAll("button")).find((button) => text(button).toLowerCase().includes("back to users"))
  if (!backButton) return null
  const scope = backButton.closest("div") ?? document.body
  const emailRe = /[^\s@]+@[^\s@]+\.[^\s@]+/
  const candidates = Array.from(scope.querySelectorAll("p,span,div,td"))
    .map((el) => text(el).match(emailRe)?.[0] ?? null)
    .filter((value): value is string => !!value)
  return candidates[0] ?? null
}

function findStorageCard(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll("h4")).find((el) => text(el).toLowerCase() === "storage quota")
  return (heading?.closest(".rounded-xl") as HTMLElement | null) ?? null
}

function roleGetsForever(role: AdminRole): boolean {
  return ROLE_DEFAULTS.has(String(role ?? "").toLowerCase())
}

function pillClasses(enabled: boolean) {
  return enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
}

function roleLabel(role: AdminRole) {
  const value = String(role ?? "user")
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function renderPanel(panel: HTMLElement, user: AdminUser, saving = false) {
  const roleDefault = roleGetsForever(user.role)
  const directGrant = !!user.keepFilesForeverGranted
  const enabled = !!user.keepFilesForever || roleDefault
  const canToggle = !roleDefault
  const nextAllowed = !directGrant
  panel.innerHTML = `
    <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Keep files forever</h4>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${pillClasses(enabled)}">${enabled ? "Enabled" : "Disabled"}</span>
      ${roleDefault ? `<span class="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">Default for ${roleLabel(user.role)}</span>` : ""}
      ${directGrant ? `<span class="rounded-full bg-drift-500/10 px-2 py-0.5 text-[11px] font-semibold text-drift-700">Direct grant</span>` : ""}
    </div>
    <p class="mt-2 text-sm text-slate-600">${roleDefault ? "Owner, admin, and moderator accounts can keep files forever by default. This profile shows that the permission is active because of their role." : enabled ? "This user has a direct keep-forever grant and can upload files without an expiry date." : "This user needs a direct grant before they can upload files without an expiry date."}</p>
    <button data-keep-forever-toggle="true" ${canToggle && !saving ? "" : "disabled"} class="mt-3 rounded-lg ${nextAllowed ? "bg-drift-500 text-white hover:bg-drift-600" : "border border-red-200 text-red-600 hover:bg-red-50"} px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">${saving ? "Saving…" : roleDefault ? "Enabled by role" : nextAllowed ? "Grant keep-forever" : "Remove keep-forever"}</button>
  `
  const button = panel.querySelector<HTMLButtonElement>("[data-keep-forever-toggle]")
  button?.addEventListener("click", async () => {
    if (!canToggle || saving) return
    renderPanel(panel, user, true)
    try {
      await json(await fetch(`${API}/api/keep-forever/users/${encodeURIComponent(user.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: nextAllowed }),
      }))
      const users = await loadUsers(true)
      const updated = users.find((row) => row.id === user.id) ?? { ...user, keepFilesForever: nextAllowed, keepFilesForeverGranted: nextAllowed }
      renderPanel(panel, updated)
    } catch (err) {
      renderPanel(panel, user)
      window.dispatchEvent(new CustomEvent("dropvault:toast", { detail: { type: "error", message: (err as Error)?.message || "Couldn't update keep-forever permission" } }))
      alert((err as Error)?.message || "Couldn't update keep-forever permission")
    }
  })
}

async function enhance() {
  if (!canRun() || busy) return
  const email = findProfileEmail()
  const storageCard = findStorageCard()
  if (!email || !storageCard) return
  const existing = document.querySelector<HTMLElement>("[data-admin-keep-forever-profile]")
  if (existing?.dataset.email === email) return
  busy = true
  try {
    const users = await loadUsers()
    const user = users.find((row) => row.email.toLowerCase() === email.toLowerCase())
    if (!user) return
    const panel = existing ?? document.createElement("div")
    panel.dataset.adminKeepForeverProfile = "true"
    panel.dataset.email = email
    panel.className = "rounded-xl border border-slate-200 p-4"
    renderPanel(panel, user)
    storageCard.insertAdjacentElement("afterend", panel)
  } catch {
    // The current user may not have admin access yet or the admin panel may not be open.
  } finally {
    busy = false
  }
}

if (canRun()) {
  const observer = new MutationObserver(() => { void enhance() })
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener("focus", () => { void enhance() })
  window.setInterval(() => { void enhance() }, 1500)
  void enhance()
}

export {}
