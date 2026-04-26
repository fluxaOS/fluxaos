export function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return (
    <div
      className={`h-4 ${width} rounded-md bg-slate-700/50 animate-skeleton`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card-static p-6 space-y-3">
      <SkeletonLine width="w-24" />
      <SkeletonLine width="w-16" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card-static p-0">
      <div className="p-5">
        <SkeletonLine width="w-48" />
      </div>
      <div className="space-y-0">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex gap-8 px-6 py-4 border-t border-slate-700/20"
          >
            <SkeletonLine width="w-32" />
            <SkeletonLine width="w-20" />
            <SkeletonLine width="w-28" />
            <SkeletonLine width="w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
