/**
 * Uploads with progress for the course builder (XMLHttpRequest: fetch has no upload progress).
 * Sends the session cookie and the CSRF header like every other state-changing request.
 */

import { CSRF_REQUEST_HEADER } from '@/lib/api-fetch';

export type UploadHandle = { promise: Promise<Record<string, unknown>>; abort: () => void };

export class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function uploadWithProgress(url: string, field: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader(CSRF_REQUEST_HEADER[0], CSRF_REQUEST_HEADER[1]);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new UploadError(typeof body.error === 'string' ? body.error : xhr.status === 413 ? 'The file is too large.' : 'The upload failed. Try again.', xhr.status));
    };
    xhr.onerror = () => reject(new UploadError('The upload was interrupted. Check your connection and try again.', 0));
    xhr.onabort = () => reject(new UploadError('Upload cancelled.', -1));
    const form = new FormData();
    form.append(field, file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
