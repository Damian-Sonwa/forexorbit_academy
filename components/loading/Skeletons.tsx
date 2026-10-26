function Bone({ className }: { className: string }) {
  return <div className={`orbit-skeleton rounded-lg ${className}`} />;
}

export function MetricSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <Bone className="h-3 w-24" />
          <Bone className="mt-4 h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CourseCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <Bone className="h-36 w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" aria-hidden="true">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Bone className="h-4 w-40" />
      </div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="grid grid-cols-4 gap-4 px-4 py-4">
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-2/3" />
            <Bone className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LessonSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Bone className="h-8 w-2/3" />
      <Bone className="aspect-video w-full rounded-2xl" />
      <Bone className="h-4 w-full" />
      <Bone className="h-4 w-full" />
      <Bone className="h-4 w-5/6" />
      <Bone className="h-4 w-4/6" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" aria-hidden="true">
      <Bone className="h-4 w-32" />
      <div className="mt-6 flex h-40 items-end gap-3">
        <Bone className="h-16 w-full" />
        <Bone className="h-28 w-full" />
        <Bone className="h-20 w-full" />
        <Bone className="h-36 w-full" />
        <Bone className="h-24 w-full" />
      </div>
    </div>
  );
}

export function InlineLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-neutral-500" role="status" aria-live="polite">
      <span className="orbit-dash inline-block h-3.5 w-3.5 rounded-full border-2 border-primary-200 border-t-primary-600" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
