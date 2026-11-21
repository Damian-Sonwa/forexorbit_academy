/**
 * Course level chips. Brand intensity rises with the level, so difficulty reads without extra
 * accent colours: beginner a quiet outline, intermediate a brand tint, advanced the brand fill.
 */
export const DIFFICULTY_CHIP: Record<string, string> = {
  beginner: '!text-ink border-[var(--fo-line-strong)] !bg-[color-mix(in_srgb,var(--fo-bg)_72%,transparent)]',
  intermediate: '!text-primary-700 dark:!text-primary-300 border-primary-400/40 !bg-[color-mix(in_srgb,var(--fo-bg)_72%,transparent)]',
  advanced: '!text-neutral-950 !bg-primary-500 border-primary-500',
};

export const difficultyChip = (level?: string | null) => DIFFICULTY_CHIP[String(level || '').toLowerCase()] || DIFFICULTY_CHIP.beginner;
