import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  THEME_OPTIONS,
  themeLabel,
  useTheme,
  type Theme,
} from "../lib/theme";
import { LAYOUT_OPTIONS, useLayout } from "../lib/layout";
import { focusFirstMenuItem, useEscapeToClose } from "../lib/useEscapeToClose";
import NotificationsBell from "./NotificationsBell";
import Logo from "./Logo";
import type { NotificationDestination } from "../lib/notificationTarget";

export type ViewMode = "grid" | "list";

const THEME_ICONS: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};
const menuInitial = { opacity: 0, scale: 0.97, y: -4 };
const menuAnimate = { opacity: 1, scale: 1, y: 0 };

// A small popover anchored under its trigger, closed by Escape or an outside
// click. Used for the settings and account menus.
function Popover({
  label,
  trigger,
  triggerClassName,
  triggerTitle,
  width = "w-80",
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  triggerTitle?: string;
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef(false);
  const close = () => setOpen(false);
  useEscapeToClose(open, close, triggerRef);
  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    focusFirstMenuItem(panelRef.current);
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          focusOnOpenRef.current = !open && e.detail === 0;
          setOpen((v) => !v);
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerTitle ?? label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-40 cursor-default"
              aria-label={`Close ${label.toLowerCase()}`}
              tabIndex={-1}
              onClick={close}
            />
            <motion.div
              ref={panelRef}
              role="menu"
              aria-label={label}
              initial={menuInitial}
              animate={menuAnimate}
              exit={menuInitial}
              className={
                "menu-surface absolute right-0 top-12 z-50 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-1rem)] overflow-y-auto " +
                width
              }
            >
              {children(close)}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pb-1 pt-2 text-xs font-medium text-muted">{children}</p>
  );
}

// Appearance and start-page choices. Shared by the settings menu and the
// account menu on phones, where the settings button is hidden.
function DisplaySettings({ close }: { close: () => void }) {
  const {
    theme,
    workspaceDefault,
    followsWorkspaceDefault,
    setTheme,
    useWorkspaceDefault,
  } = useTheme();
  const { layout, setLayout } = useLayout();
  return (
    <div data-ui="display-settings">
      <MenuHeading>Appearance</MenuHeading>
      {THEME_OPTIONS.map((option) => {
        const Icon = THEME_ICONS[option.id];
        const active = !followsWorkspaceDefault && theme === option.id;
        return (
          <button
            key={option.id}
            role="menuitemradio"
            aria-checked={active}
            className="menu-item"
            onClick={() => {
              setTheme(option.id);
              close();
            }}
          >
            <Icon size={18} />
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              <span className="block text-xs text-faint">
                {option.description}
              </span>
            </span>
            {active && <Check size={18} className="!text-primary" />}
          </button>
        );
      })}
      <button
        role="menuitemradio"
        aria-checked={followsWorkspaceDefault}
        className="menu-item"
        onClick={() => {
          useWorkspaceDefault();
          close();
        }}
      >
        <RotateCcw size={18} />
        <span className="min-w-0 flex-1">
          <span className="block">Use workspace default</span>
          <span className="block text-xs text-faint">
            Currently {themeLabel(workspaceDefault)}
          </span>
        </span>
        {followsWorkspaceDefault && (
          <Check size={18} className="!text-primary" />
        )}
      </button>
      <div className="menu-divider" />
      <MenuHeading>Start page</MenuHeading>
      {LAYOUT_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = layout === option.id;
        return (
          <button
            key={option.id}
            role="menuitemradio"
            aria-checked={active}
            className="menu-item"
            onClick={() => {
              setLayout(option.id);
              close();
            }}
          >
            <Icon size={18} />
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              <span className="block text-xs text-faint">{option.desc}</span>
            </span>
            {active && <Check size={18} className="!text-primary" />}
          </button>
        );
      })}
    </div>
  );
}

export default function Topbar({
  search,
  setSearch,
  userName,
  userEmail,
  onSignOut,
  onOpenMenu,
  onOpenSecurity,
  onOpenTeams,
  onGoHome,
  onNotificationNavigate,
}: {
  search: string;
  setSearch: (s: string) => void;
  userName?: string;
  userEmail?: string;
  onSignOut: () => void;
  onOpenMenu?: () => void;
  onOpenSecurity?: () => void;
  onOpenTeams?: () => void;
  onGoHome?: () => void;
  onNotificationNavigate?: (destination: NotificationDestination) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = (userName?.[0] ?? userEmail?.[0] ?? "U").toUpperCase();
  return (
    <header
      className="sticky top-0 z-30 bg-app"
      data-ui="topbar"
    >
      <div className="flex h-16 items-center gap-1 px-2 sm:gap-2 sm:pr-4 md:pl-0">
        <div className="hidden w-64 shrink-0 items-center pl-5 md:flex">
          <button
            type="button"
            onClick={onGoHome}
            aria-label="Go to My Drive"
            title="Go to My Drive"
            className="rounded-full pr-2"
            data-ui="home-link"
          >
            <Logo />
          </button>
        </div>
        <div
          className="group/search relative flex h-12 min-w-0 max-w-[45rem] flex-1 items-center rounded-full bg-field transition focus-within:bg-sheet focus-within:[box-shadow:var(--shadow-sm)]"
          role="search"
        >
          <button
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="icon-round ml-1 md:hidden"
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            aria-label="Search"
            tabIndex={-1}
            className="icon-round ml-1 hidden md:grid"
          >
            <Search size={20} />
          </button>
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                e.stopPropagation();
                setSearch("");
              }
            }}
            placeholder="Search in Dropvault"
            title="Search (press /)"
            aria-label="Search in Dropvault"
            aria-keyshortcuts="/"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-base text-strong outline-none placeholder:text-muted focus-visible:!outline-none [&::-webkit-search-cancel-button]:hidden"
            data-ui="search"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="icon-round mr-1"
            >
              <X size={20} />
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <NotificationsBell onNavigate={onNotificationNavigate} />
          <div className="hidden sm:block">
            <Popover
              label="Settings"
              trigger={<Settings size={20} />}
              triggerClassName="icon-round"
            >
              {(close) => <DisplaySettings close={close} />}
            </Popover>
          </div>
          <Popover
            label="Account menu"
            triggerTitle={userEmail ? `Account: ${userEmail}` : "Account"}
            trigger={
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#0b57d0] text-sm font-medium text-white">
                {initial}
              </span>
            }
            triggerClassName="grid h-10 w-10 place-items-center rounded-full hover:bg-[rgb(var(--c-strong)/0.08)]"
            width="w-80"
          >
            {(close) => (
              <div data-ui="account-menu">
                <div className="flex flex-col items-center px-4 pb-3 pt-2 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-[#0b57d0] text-2xl font-medium text-white">
                    {initial}
                  </span>
                  {userName && (
                    <p className="mt-2 text-base font-medium text-strong">
                      Hi, {userName.split(" ")[0]}!
                    </p>
                  )}
                  {userEmail && (
                    <p className="max-w-full truncate text-sm text-muted">
                      {userEmail}
                    </p>
                  )}
                </div>
                <div className="menu-divider" />
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onOpenTeams?.();
                  }}
                >
                  <Users size={18} /> Teams & shared spaces
                </button>
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onOpenSecurity?.();
                  }}
                >
                  <ShieldCheck size={18} /> Account security
                </button>
                <div className="sm:hidden">
                  <div className="menu-divider" />
                  <DisplaySettings close={close} />
                </div>
                <div className="menu-divider" />
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onSignOut();
                  }}
                >
                  <LogOut size={18} /> Sign out
                </button>
              </div>
            )}
          </Popover>
        </div>
      </div>
    </header>
  );
}
