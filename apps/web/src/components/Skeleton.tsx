// Shimmering placeholders shown while data loads, replacing plain "Loading…" text.
// Uses the same shapes as FileCard/FolderCard so the layout doesn't jump.

function Block({ className = "" }: { className?: string }) {
  return <div className={"animate-pulse rounded bg-slate-200 " + className} />;
}

export function FolderSkeleton() {
  return (
    <div className="flex h-12 items-center gap-3 rounded-xl bg-slate-100 px-4">
      <Block className="h-5 w-5 shrink-0 !rounded" />
      <Block className="h-3.5 flex-1" />
    </div>
  );
}

export function FileGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col rounded-xl bg-slate-100 px-1 pb-1">
          <div className="flex h-12 items-center gap-2 px-3">
            <Block className="h-4 w-4 shrink-0" />
            <Block className="h-3.5 flex-1" />
          </div>
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-white" />
          <div className="px-2 py-2">
            <Block className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex h-12 items-center gap-3 border-b border-slate-200 px-3"
        >
          <Block className="h-6 w-6 shrink-0" />
          <Block className="h-3.5 w-1/3" />
          <Block className="ml-auto hidden h-3 w-20 sm:block" />
          <Block className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function FolderGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <FolderSkeleton key={i} />
      ))}
    </div>
  );
}
