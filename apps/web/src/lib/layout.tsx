import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { House, LayoutGrid, type LucideIcon } from "lucide-react";

// The layout is orthogonal to the light/dark appearance in theme.tsx. "calm"
// opens on a Home page (greeting, suggested files, storage overview) and opens
// a file's details on click; "classic" goes straight to the file list and
// opens previews on click.
export type Layout = "calm" | "classic";

export const LAYOUTS: Layout[] = ["calm", "classic"];
const STORAGE_KEY = "dropvault-layout";

export const LAYOUT_OPTIONS: {
  id: Layout;
  label: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  {
    id: "calm",
    label: "Calm",
    desc: "Home page with suggested files; click opens details",
    icon: House,
  },
  {
    id: "classic",
    label: "Classic",
    desc: "Straight to your files; click opens a preview",
    icon: LayoutGrid,
  },
];

function isLayout(value: unknown): value is Layout {
  return value === "calm" || value === "classic";
}

function readStoredLayout(): Layout {
  if (typeof localStorage === "undefined") return "calm";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLayout(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "calm";
}

type LayoutContextValue = {
  layout: Layout;
  setLayout: (layout: Layout) => void;
};

const LayoutContext = createContext<LayoutContextValue>({
  layout: "calm",
  setLayout: () => {},
});

export function useLayout() {
  return useContext(LayoutContext);
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayoutState] = useState<Layout>(readStoredLayout);

  const setLayout = useCallback((next: Layout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LayoutContextValue>(
    () => ({ layout, setLayout }),
    [layout, setLayout],
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}
