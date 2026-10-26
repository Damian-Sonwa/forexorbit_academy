/**
 * Chooses a loading treatment without rendering UI.
 * authorized null means the session is still unresolved.
 */
function resolveLoadingPresentation(input) {
  const authLoading = Boolean(input && input.authLoading);
  const authorized = input ? input.authorized : null;
  const dataLoading = Boolean(input && input.dataLoading);
  const error = Boolean(input && input.error);
  const hasData = Boolean(input && input.hasData);

  if (authLoading || authorized == null) return 'full-page';
  if (!authorized) return 'blocked';
  if (error && !hasData) return 'error';
  if (dataLoading && !hasData) return 'skeleton';
  if (dataLoading && hasData) return 'refresh';
  if (!hasData) return 'empty';
  return 'content';
}

module.exports = { resolveLoadingPresentation };
