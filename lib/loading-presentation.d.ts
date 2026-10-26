export type LoadingPresentation =
  | 'full-page'
  | 'blocked'
  | 'skeleton'
  | 'refresh'
  | 'error'
  | 'empty'
  | 'content';

export function resolveLoadingPresentation(input: {
  authLoading?: boolean;
  authorized?: boolean | null;
  dataLoading?: boolean;
  error?: unknown;
  hasData?: boolean;
}): LoadingPresentation;
