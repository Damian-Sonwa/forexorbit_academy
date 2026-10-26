export function unexpectedBody(operation: string, error?: unknown): {
  error: string;
  code: string;
  requestId: string;
};

export function publicUploadFailure(
  error: unknown,
  options?: { limitMessage?: string }
): {
  status: number;
  body: { error: string; code?: string; requestId?: string };
};

export function publicBody(code: string, message: string): {
  error: string;
  code: string;
  requestId: string;
};

export function looksSensitive(text: unknown): boolean;

export function clientFacingError(input: {
  status?: number;
  error?: string;
  code?: string;
  requestId?: string;
}): { message: string; code: string; requestId: string };

export function messageFromUnknown(error: unknown): string;

export function logUnexpected(operation: string, error: unknown, requestId: string): void;
