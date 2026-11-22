import type { Block, DeltaOp } from './course-content';

export type GenerationMode = 'generate' | 'improve' | 'expand' | 'rewrite' | 'section' | 'simplify' | 'examples' | 'checks';
export type KnowledgeCheck = { question: string; options: string[]; correctIndex: number; explanation: string };
export type QualityCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string };
export type GenerationContext = {
  course: { title: string; summary: string; description: string; difficulty: string; category: string; objectives: string[] };
  module: { title: string; lessons: string[] };
  topic: { title: string; position: number; total: number };
  prerequisites: string[];
  nearest: Array<{ title: string; excerpt: string }>;
  upcoming: string[];
  existing: string;
  existingWords: number;
  mediaIds: string[];
};
export type ParsedLesson = {
  sections: Array<{ kind: string; heading: string; body: string; keep: string[] }>;
  calculations: Array<Record<string, unknown>>;
  knowledgeChecks: KnowledgeCheck[];
  suggestions: string[];
};

export const MODES: readonly GenerationMode[];
export const WHOLE_LESSON_MODES: readonly GenerationMode[];
export const SECTION_KINDS: Readonly<Record<string, string>>;
export const INSTRUCTIONS_MAX: number;
export const CONTEXT_CHARS: number;
export const SYSTEM: string;
export class GenerationError extends Error { code: string; constructor(code: string, message: string); }
export function lessonAsText(lesson: unknown): string;
export function wordCount(s: unknown): number;
export function buildContext(input: { course: unknown; lessons: unknown[]; lessonId: string }): GenerationContext | null;
export function buildPrompt(mode: GenerationMode, ctx: GenerationContext, options?: { sectionKind?: string; instructions?: string }): { system: string; user: string };
export function maxTokensFor(mode: GenerationMode): number;
export function extractJson(content: string): unknown;
export function parseLesson(content: string, options: { mode: GenerationMode; finishReason: string | null }): ParsedLesson;
export function bodyToOps(body: string): DeltaOp[];
export function toBlocks(parsed: ParsedLesson, options: { mode: GenerationMode; existingBlocks?: Block[] }): { blocks: Block[]; calculations: Array<Record<string, unknown>> };
export function assessQuality(input: { mode: GenerationMode; ctx: GenerationContext; parsed: ParsedLesson; blocks: Block[]; calculations: Array<Record<string, unknown>> }): { checks: QualityCheck[]; blocks: number; words: number };
