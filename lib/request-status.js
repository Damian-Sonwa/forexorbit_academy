function isAbortedRequest(error) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error;
  return candidate.code === 'ERR_CANCELED'
    || candidate.name === 'CanceledError'
    || candidate.message === 'Request aborted';
}

module.exports = { isAbortedRequest };
