export const ACTIVE_EXTENSIONS: ReadonlySet<string>;
export function isActiveContent(file: { originalFilename?: string | null; mimetype?: string | null }): boolean;
export function storedFileName(originalFilename: string | null | undefined): string;
