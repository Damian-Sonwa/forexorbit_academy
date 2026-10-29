const STATUS_MESSAGES = {
  400: 'Please check the information you entered.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You are not authorized to perform this action.',
  404: 'This item could not be found.',
  409: 'We could not complete your request. Please try again.',
  429: 'Please wait a moment and try again.',
  500: 'Something went wrong. Please try again later.',
  503: 'The service is temporarily unavailable. Please try again later.',
};

/**
 * 16 hex characters that tie a logged error to the id shown to the user. Not a secret.
 * Uses Web Crypto (browsers, Node 19+) rather than require('crypto'): this file is also bundled
 * for the browser through lib/api-client.ts, and requiring Node's crypto made webpack ship a
 * ~100 kB crypto polyfill in the shared _app chunk of every page.
 */
function newRequestId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let id = '';
  for (let i = 0; i < 16; i += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

function oneLine(value, max) {
  return String(value || '').replace(/[\r\n]/g, ' ').slice(0, max);
}

function logUnexpected(operation, error, requestId) {
  const name = error && typeof error.name === 'string' ? oneLine(error.name, 60) : 'Error';
  const code = error && (typeof error.code === 'string' || typeof error.code === 'number')
    ? oneLine(error.code, 40)
    : '';
  console.error(`[${requestId}] ${oneLine(operation, 80)} failed ${name}${code ? ' ' + code : ''}`);
}

function unexpectedBody(operation, error) {
  const requestId = newRequestId();
  logUnexpected(operation || 'request', error, requestId);
  return {
    error: STATUS_MESSAGES[500],
    code: 'INTERNAL_ERROR',
    requestId,
  };
}

const UPLOAD_UNAVAILABLE = 'Image upload service is not configured. Please contact support.';

function publicUploadFailure(error, options) {
  const limitMessage = options && typeof options.limitMessage === 'string' ? options.limitMessage : '';
  if (limitMessage && error && error.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, body: { error: limitMessage } };
  }
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (message.includes('Cloudinary configuration is missing')) {
    const requestId = newRequestId();
    logUnexpected('upload', { name: 'UploadConfigError', code: 'UPLOAD_UNAVAILABLE' }, requestId);
    return {
      status: 500,
      body: { error: UPLOAD_UNAVAILABLE, code: 'UPLOAD_UNAVAILABLE', requestId },
    };
  }
  return { status: 500, body: unexpectedBody('upload', error) };
}

function publicBody(code, message) {
  return {
    error: message,
    code,
    requestId: newRequestId(),
  };
}

function looksSensitive(text) {
  const value = String(text || '');
  if (!value) return false;
  if (value.length > 240) return true;
  return /mongodb(\+srv)?:\/\//i.test(value)
    || /Mongo(Server|Network|Parse)/.test(value)
    || /E11000/.test(value)
    || /node_modules/.test(value)
    || /[A-Za-z]:\\Users\\|\/Users\/|\/home\//.test(value)
    || /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(value)
    || /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    || /ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(value)
    || /at\s+.+\(.+:\d+:\d+\)/.test(value);
}

function clientFacingError(input) {
  const status = Number(input && input.status) || 0;
  const code = input && typeof input.code === 'string' ? input.code : '';
  const requestId = input && typeof input.requestId === 'string' ? input.requestId : '';
  const raw = input && typeof input.error === 'string' ? input.error : '';
  if (code === 'INTERNAL_ERROR' || status >= 500 || looksSensitive(raw) || /^Request failed with status code/i.test(raw)) {
    const message = STATUS_MESSAGES[status] || STATUS_MESSAGES[500];
    return { message: status >= 500 || !STATUS_MESSAGES[status] ? STATUS_MESSAGES[500] : message, code: code || 'INTERNAL_ERROR', requestId };
  }
  if (raw) {
    return { message: raw, code, requestId };
  }
  return {
    message: STATUS_MESSAGES[status] || 'We could not complete your request. Please try again.',
    code,
    requestId,
  };
}

function messageFromUnknown(error) {
  if (!error || typeof error !== 'object') {
    return 'We could not complete your request. Please try again.';
  }
  const candidate = error;
  if (candidate.code === 'ERR_CANCELED' || candidate.name === 'CanceledError' || candidate.message === 'Request aborted') {
    return '';
  }
  const response = candidate.response;
  const status = response && response.status;
  const data = response && response.data && typeof response.data === 'object' ? response.data : {};
  if (candidate.code === 'ECONNABORTED') {
    return 'The request took too long. Please try again.';
  }
  if (!response) {
    return 'We could not reach the service. Check your connection and try again.';
  }
  return clientFacingError({
    status,
    error: typeof data.error === 'string' ? data.error : '',
    code: typeof data.code === 'string' ? data.code : '',
    requestId: typeof data.requestId === 'string' ? data.requestId : '',
  }).message;
}

module.exports = {
  STATUS_MESSAGES,
  unexpectedBody,
  publicUploadFailure,
  publicBody,
  looksSensitive,
  clientFacingError,
  messageFromUnknown,
  logUnexpected,
};
