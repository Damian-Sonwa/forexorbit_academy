/** Types for lib/communication/metrics.js. */
export type MetricsSnapshot = { startedAt: string; counters: Record<string, number>; gauges: Record<string, number>; lastWorker: Record<string, unknown> | null };
export function count(name: string, by?: number): void;
export function gauge(name: string, delta: number): void;
export function worker(summary: Record<string, unknown>): void;
export function snapshot(): MetricsSnapshot;
export function socketServer(): unknown;
