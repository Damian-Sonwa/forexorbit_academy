export function documentPath(lessonId: string, item: string): string;
export function documentType(declared: unknown, url: unknown): string;
export function isDocumentItem(value: unknown): boolean;
export function presentStudentDocuments<T>(view: T): T;
export function resolveLessonDocument(lesson: Record<string, unknown> | null | undefined, item: unknown): string | null;
export function setPrivateNoStore(res: { setHeader(name: string, value: string): unknown }): void;
