// Shimmering placeholders shown while data loads, replacing plain "Loading…" text.
// Uses the same card shapes as FileCard/FolderCard so the layout doesn't jump.

function Block({ className = "" }: { className?: string }) {
  return (
    <div className={"animate-pulse rounded bg-slate-200/70 " + className} />
  );
}

export function FolderSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 drive-shadow">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-200/70" />
      <div className="min-w-0 flex-1 space-y-2">
        <Block className="h-3.5 w-2/3" />
        <Block className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

export function FileGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-slate-200 bg-white drive-shadow"
        >
          <div className="h-24 animate-pulse rounded-t-2xl bg-slate-200/70" />
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-slate-200/70" />
            <Block className="h-3.5 flex-1" />
          </div>
          <div className="px-3 pb-2.5">
            <Block className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white drive-shadow">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-slate-200/70" />
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-3.5 w-1/2" />
            <Block className="h-2.5 w-1/4" />
          </div>
          <Block className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function FolderGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <FolderSkeleton key={i} />
      ))}
    </div>
  );
}
