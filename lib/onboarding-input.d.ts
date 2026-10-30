export type LearningLevelName = 'beginner' | 'intermediate' | 'advanced';
export const LEVELS: readonly LearningLevelName[];
export function checkOnboardingInput(body: unknown):
  | { ok: true; name: string; level: LearningLevelName; details: Record<string, unknown> }
  | { ok: false; status: 400; error: string };
