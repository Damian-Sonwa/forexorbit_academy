export const MAX_NOTES_LENGTH: number;
export function readJournalEntry(body: unknown): { ok: true; fields: any } | { ok: false; status: number; error: string };
export function taskIsFor(task: any, userId: string): boolean;
export function completionFor(task: any, userId: string): { completed: boolean; completedAt: any };
