'use strict';

/**
 * Cloudflare R2 storage (S3-compatible) without an SDK: requests are signed with AWS Signature
 * Version 4 query parameters (presigned URLs) using Node's crypto, so no dependency is added.
 *
 * Two buckets, each optional:
 *   images  R2_IMAGES_BUCKET + R2_PUBLIC_BASE_URL   public lesson and cover images. The bucket is
 *           served publicly (an r2.dev address or a custom domain set in Cloudflare); only
 *           checked images with random names are written here.
 *   files   R2_FILES_BUCKET                         private course files (documents, video). No
 *           public access: readers get a presigned link that expires after a few minutes, issued
 *           only after the app's access check.
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   the API token (Object Read & Write)
 *   R2_ENDPOINT   optional; defaults to https://<account>.r2.cloudflarestorage.com
 *
 * Keys and secrets stay on the server; signed links carry only a signature and an expiry.
 */

const crypto = require('crypto');
const fs = require('fs');

const REGION = 'auto';
const SERVICE = 's3';

function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function baseConfig(env = process.env) {
  const accountId = text(env.R2_ACCOUNT_ID);
  const accessKeyId = text(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = text(env.R2_SECRET_ACCESS_KEY);
  const endpoint = (text(env.R2_ENDPOINT) || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
  if (!accessKeyId || !secretAccessKey || !/^https?:\/\//.test(endpoint)) return null;
  return { endpoint, accessKeyId, secretAccessKey };
}

/** Public image storage: { endpoint, bucket, publicBaseUrl, ... } or null. */
function r2ImagesConfig(env = process.env) {
  const base = baseConfig(env);
  const bucket = text(env.R2_IMAGES_BUCKET);
  const publicBaseUrl = text(env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '');
  if (!base || !bucket || !/^https?:\/\//.test(publicBaseUrl)) return null;
  return { ...base, bucket, publicBaseUrl };
}

/** Private file storage: { endpoint, bucket, ... } or null. */
function r2FilesConfig(env = process.env) {
  const base = baseConfig(env);
  const bucket = text(env.R2_FILES_BUCKET);
  if (!base || !bucket) return null;
  return { ...base, bucket };
}

/** RFC 3986 encoding as S3 expects ('/' kept in paths when `path` is true). */
function encode(value, path = false) {
  const out = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return path ? out.replace(/%2F/g, '/') : out;
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * A presigned URL (SigV4, query authentication, unsigned payload). Generic so it can be checked
 * against AWS's published example. `host` is the request host, `path` the encoded path.
 */
function presign({ method, protocol = 'https:', host, path, query = {}, accessKeyId, secretAccessKey, region = REGION, service = SERVICE, expires = 300, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${encode(k)}=${encode(String(params[k]))}`).join('&');
  const canonicalRequest = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
  return `${protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** A presigned URL for one object in a configured bucket (path-style addressing). */
function objectUrl(config, method, key, { expires = 300, query = {}, now } = {}) {
  const url = new URL(config.endpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  return presign({
    method,
    protocol: url.protocol,
    host: url.host,
    path: `${basePath}/${encode(config.bucket)}/${encode(key, true)}`,
    query,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expires,
    now,
  });
}

class R2Error extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Uploads a file. `fetchImpl` is for tests. */
async function putObject(config, key, filePath, { contentType, cacheControl, fetchImpl = globalThis.fetch } = {}) {
  const body = await fs.promises.readFile(filePath);
  const res = await fetchImpl(objectUrl(config, 'PUT', key, { expires: 600 }), {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream', ...(cacheControl ? { 'Cache-Control': cacheControl } : {}) },
    body,
  });
  if (!res.ok) throw new R2Error(`R2 upload failed (${res.status})`, res.status);
  return { key, bytes: body.length };
}

async function deleteObject(config, key, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(objectUrl(config, 'DELETE', key, { expires: 300 }), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new R2Error(`R2 delete failed (${res.status})`, res.status);
}

/** A short-lived download link; `filename` makes the browser save it under that name. */
function signedGetUrl(config, key, { expires = 300, filename = null, inline = false } = {}) {
  const query = {};
  if (filename) {
    const safe = String(filename).replace(/["\r\n\\]/g, '').slice(0, 150) || 'file';
    query['response-content-disposition'] = `${inline ? 'inline' : 'attachment'}; filename="${safe}"`;
  }
  return objectUrl(config, 'GET', key, { expires, query });
}

/** The public address of an image in the public bucket. */
function publicUrl(config, key) {
  return `${config.publicBaseUrl}/${encode(key, true)}`;
}

module.exports = { R2Error, deleteObject, encode, objectUrl, presign, publicUrl, putObject, r2FilesConfig, r2ImagesConfig, signedGetUrl };
