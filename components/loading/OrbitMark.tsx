interface OrbitMarkProps {
  className?: string;
}

export function OrbitMark({ className = 'h-14 w-14' }: OrbitMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="22" className="stroke-primary-100 dark:stroke-neutral-700" strokeWidth="2" />
      <circle cx="32" cy="32" r="14" className="stroke-primary-200 dark:stroke-neutral-600" strokeWidth="1.5" />
      <circle
        cx="32"
        cy="32"
        r="22"
        className="orbit-dash stroke-primary-600"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="34 104"
      />
      <circle cx="32" cy="32" r="3.5" className="fill-primary-500" />
    </svg>
  );
}
