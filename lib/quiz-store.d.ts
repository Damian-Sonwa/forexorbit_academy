import type { Collection, Document, WithId } from 'mongodb';

export function isDuplicateKey(error: unknown): boolean;
export function saveQuizVersion(
  quizzes: Collection<Document>,
  input: { lessonId: string; set: Document; now: Date }
): Promise<WithId<Document> | null>;
