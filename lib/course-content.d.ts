export type DeltaOp = { insert: string; attributes?: Record<string, unknown> };
export type Segment = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; link?: string };
export type Line = { kind: 'p' | 'h2' | 'h3' | 'quote' | 'li'; list?: 'ordered' | 'bullet'; indent?: number; segments: Segment[] };
export type LineGroup = Line | { kind: 'list'; list: 'ordered' | 'bullet'; items: Line[] };

export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'text' | 'archive' | 'file';
export type CalloutTone = 'info' | 'tip' | 'warning' | 'key';

export type Block =
  | { id: string; type: 'heading'; text: string; level: 2 | 3 }
  | { id: string; type: 'text'; ops: DeltaOp[] }
  | { id: string; type: 'callout'; tone: CalloutTone; title: string; text: string }
  | { id: string; type: 'image'; url: string; alt: string; caption: string }
  | { id: string; type: 'video'; url?: string | null; assetId?: string; caption: string; available?: boolean }
  | { id: string; type: 'file'; url?: string | null; assetId?: string; title: string; kind: FileKind; name?: string; bytes?: number; available?: boolean; legacyItem?: string }
  | { id: string; type: 'link'; url: string; title: string; description: string; legacyItem?: string }
  | { id: string; type: 'code'; text: string; label: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'legacy'; field: 'description' | 'content' };

export type BlockType = Block['type'];
export type Refusal = { ok: false; status: number; code: string; field?: string; error: string };

export type Module = { id: string; title: string; implicit?: boolean };
export type ModuleWithLessons<L> = Module & { lessons: L[] };

export type ReadinessIssue = { level: 'error' | 'warning'; message: string; area: 'details' | 'curriculum' | 'lesson'; field?: string; lessonId?: string; blockId?: string; moduleId?: string };
export type Readiness = { ready: boolean; errors: number; warnings: number; issues: ReadinessIssue[] };

export const ASSET_ID: RegExp;
export const BLOCK_ID: RegExp;
export const MODULE_ID: RegExp;
export const BLOCK_TYPES: readonly BlockType[];
export const CALLOUT_TONES: readonly CalloutTone[];
export const FILE_KINDS: readonly FileKind[];
export const IMPLICIT_MODULE_ID: string;
export const LIMITS: Readonly<Record<string, number>>;

export function normalizeDelta(input: unknown): { ok: true; ops: DeltaOp[]; chars: number } | Refusal;
export function deltaText(ops: unknown): string;
export function deltaToLines(ops: unknown): Line[];
export function groupLines(lines: Line[]): LineGroup[];
export function checkBlock(raw: unknown, index: number, options?: { assetIds?: Set<string> | null }): { ok: true; block: Block } | Refusal;
export function checkBlocks(input: unknown, options?: { assetIds?: Set<string> | null }): { ok: true; blocks: Block[] } | Refusal;
export function legacyBlocks(lesson: unknown): Block[];
export function lessonBlocks(lesson: unknown): Block[];
export function usesBlocks(lesson: unknown): boolean;
export function blockHasContent(block: Block, lesson?: unknown): boolean;
export function mirroredLessonFields(blocks: Block[]): { videoUrl: string | null; type: string; contentFormat: 'blocks' };
export function lessonKinds(lesson: unknown): Array<'video' | 'file' | 'image' | 'link' | 'text'>;
export function readingMinutes(lesson: unknown): number;
export function fileKindOf(name: unknown, declared?: unknown): FileKind;
export function blockDocumentPath(lessonId: string, blockId: string): string;
export function blockItemId(item: unknown): string | null;
export function presentBlocksForStudent(blocks: unknown, lessonId: string): Block[];
export function courseModules(course: unknown): Module[];
export function curriculum<L extends { _id: unknown; order?: unknown; moduleId?: unknown }>(course: unknown, lessons: L[]): Array<ModuleWithLessons<L>>;
export function curriculumOrder(course: unknown, lessons: Array<{ _id: unknown; order?: unknown; moduleId?: unknown }>): string[];
export function checkCurriculum(input: unknown, currentLessonIds: string[]):
  | { ok: true; modules: Module[]; assignments: Array<{ lessonId: string; moduleId: string; order: number }> }
  | Refusal;
export function checkCourseDetails(body: unknown): { ok: true; fields: Record<string, unknown> } | Refusal;
export function courseReadiness(input: { course: unknown; lessons: unknown[]; quizzes?: Map<string, { questions: number; status?: string }>; assetIds?: Set<string> }): Readiness;
export function newId(length?: number): string;
