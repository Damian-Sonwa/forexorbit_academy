/** What the student routes use from the engine (engine.js). Figures stay inside the result objects. */
export type EngineResult = {
  ok: boolean;
  status?: number;
  code?: string;
  error?: string;
  nextResetAt?: string;
  order?: unknown;
  position?: unknown;
  account?: unknown;
  preview?: unknown;
  repeated?: boolean;
  alreadyClosed?: boolean;
};
type EngineCall = (db: unknown, input: Record<string, unknown>) => Promise<EngineResult>;
export const cancelOrder: EngineCall;
export const closePosition: EngineCall;
export const ensureAccount: EngineCall;
export const modifyPosition: EngineCall;
export const placeOrder: EngineCall;
export const previewOrder: EngineCall;
export const resetAccount: EngineCall;
