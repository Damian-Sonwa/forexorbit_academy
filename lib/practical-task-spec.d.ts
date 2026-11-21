/** Types for lib/practical-task-spec.js (the task definition and rubric rules). */
import type { AutoCheck, Block, Difficulty, GradingMode } from './practical-tasks';

export const SCHEMA: 'practical_v2';
export const DEFAULT_GRADING_MODE: 'automatic';
export const GRADING_MODES: readonly GradingMode[];
export const DIFFICULTIES: readonly Difficulty[];
export const INSTRUMENT_IDS: readonly string[];
export const EXTERNAL_POLICIES: readonly ['none', 'optional', 'required'];
export const COMPETENCIES: readonly string[];
export const TASK_STATUSES: readonly string[];
export const TEXT_LIMITS: Readonly<Record<string, number>>;
export const CATEGORIES: Readonly<Record<string, { label: string; competency: string }>>;
export const AUTO_CHECKS: Readonly<Record<AutoCheck, { label: string; describe: (r: Record<string, unknown>) => string }>>;
export function cleanText(value: unknown, max: number, options?: { multiline?: boolean }): string | null;
export function formatBlocks(text: string): Block[];
export function readTaskDefinition(input: unknown, options?: { now?: Date }): { ok: true; task: Record<string, unknown> } | { ok: false; status: number; field: string; error: string };
export function readRubric(input: unknown, requirements: Record<string, unknown>): { ok: true; rubric: Record<string, unknown> } | { ok: false; status: number; field: string; error: string };
export function presentTaskForStudent(task: Record<string, unknown>): Record<string, unknown>;
