'use strict';

/**
 * Looks inside every uploaded file. What a file is comes from its contents; the name and the type the
 * browser sent are never trusted. A name that contradicts the contents is refused (images excepted:
 * they are rewritten under their real type).
 *
 *   images     decoded in full and written again, so hidden data and appended bytes do not survive
 *   PDF        complete, not password protected, no scripts, program launches or embedded files
 *   Office     a real document of the named kind, no macros or ActiveX
 *   ZIP        readable, not encrypted, not a zip bomb, no programs, scripts or web pages inside
 *   RTF        no embedded objects
 *   text       no binary data anywhere, not a web page in disguise
 *   video      MP4/MOV: the container must be whole; WebM and audio: the header must be right
 *
 * This is a structural check, not an antivirus engine.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
const { TYPES, matchesSignature, detectImage } = require('./course-asset-files');
const { ACTIVE_EXTENSIONS } = require('./upload-safety');

const MB = 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_INSPECT_BYTES = 25 * MB;
const IMAGE_MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const IMAGE_EXTS = Object.keys(IMAGE_MIME);
const AUDIO = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
const CHAT_EXTS = [...IMAGE_EXTS, ...Object.keys(TYPES), ...Object.keys(AUDIO)];
const NOT_IN_ZIP = new Set([...ACTIVE_EXTENSIONS, '.com', '.scr', '.pif', '.cpl', '.jar', '.lnk', '.reg', '.apk', '.app', '.dmg', '.iso', '.img', '.vbe', '.wsf', '.docm', '.xlsm', '.pptm', '.xlam', '.zip', '.rar', '.7z', '.gz', '.tar']);

class Refused extends Error {}
const refuse = (message) => { throw new Refused(message); };

/** A new random file name (128 bits) with a checked extension. */
function randomFileName(ext) {
  return `${crypto.randomBytes(16).toString('hex')}${/^[a-z0-9]{1,5}$/.test(String(ext || '')) ? `.${ext}` : ''}`;
}

function namedExt(name) {
  const ext = path.extname(String(name || '').trim().replace(/[.\s]+$/, '')).slice(1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

// ---- images ---------------------------------------------------------------------------------

async function rewriteImage(bytes, ext) {
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, animated: ext === 'gif' || ext === 'webp', failOn: 'error' }).autoOrient();
    if (ext === 'jpg') return await image.jpeg({ quality: 92 }).toBuffer();
    if (ext === 'png') return await image.png({ compressionLevel: 9 }).toBuffer();
    if (ext === 'gif') return await image.gif().toBuffer();
    return await image.webp({ quality: 92 }).toBuffer();
  } catch {
    return refuse('This image is damaged or too large to open.');
  }
}

// ---- PDF ------------------------------------------------------------------------------------

const PDF_ACTIVE = /\/(?:JavaScript|Launch|EmbeddedFiles?|RichMedia)(?![A-Za-z0-9])/;
const PDF_ACTIVE_MESSAGE = 'This PDF contains scripts, programs or embedded files. Save it as a plain PDF and upload it again.';
const PDF_UNREADABLE = 'This PDF could not be checked. Export it again as a standard PDF.';
// Names may be written with hex escapes (/Java#53cript).
const pdfNames = (text) => text.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

function checkPdf(bytes) {
  const raw = bytes.toString('latin1');
  if (!/%%EOF[\s\0]*$/.test(raw.slice(-1024))) refuse('This PDF is incomplete or has extra data after its end.');
  const text = pdfNames(raw);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(text)) refuse('Password-protected PDFs cannot be checked. Remove the protection and upload it again.');
  if (PDF_ACTIVE.test(text)) refuse(PDF_ACTIVE_MESSAGE);
  // Objects can also be packed inside compressed object streams.
  let budget = 100 * MB;
  const marker = /\/O(?:b|#62)(?:j|#6[aA])(?:S|#53)(?:t|#74)(?:m|#6[dD])(?![A-Za-z0-9])/g;
  for (let m = marker.exec(raw); m; m = marker.exec(raw)) {
    const start = /stream\r?\n/.exec(raw.slice(m.index, m.index + 4096));
    if (!start) continue;
    const from = m.index + start.index + start[0].length;
    const end = raw.indexOf('endstream', from);
    let inner;
    try {
      inner = zlib.inflateSync(bytes.subarray(from, end < 0 ? bytes.length : end), { maxOutputLength: 20 * MB, finishFlush: zlib.constants.Z_SYNC_FLUSH });
    } catch {
      return refuse(PDF_UNREADABLE);
    }
    budget -= inner.length;
    if (budget <= 0) refuse(PDF_UNREADABLE);
    if (PDF_ACTIVE.test(pdfNames(inner.toString('latin1')))) refuse(PDF_ACTIVE_MESSAGE);
  }
}

// ---- ZIP and the formats built on it --------------------------------------------------------

/** The central directory: what the archive says it holds. */
function zipEntries(bytes) {
  const damaged = () => refuse('This file is damaged.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) damaged();
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  if (count > 5000) refuse('This archive holds too many files.');
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) damaged();
    const nameLength = bytes.readUInt16LE(at + 28);
    const entry = {
      flags: bytes.readUInt16LE(at + 8),
      method: bytes.readUInt16LE(at + 10),
      packed: bytes.readUInt32LE(at + 20),
      size: bytes.readUInt32LE(at + 24),
      mode: bytes.readUInt32LE(at + 38) >>> 16,
      offset: bytes.readUInt32LE(at + 42),
      name: bytes.toString('utf8', at + 46, at + 46 + nameLength),
    };
    if (entry.offset + 30 > bytes.length || bytes.readUInt32LE(entry.offset) !== 0x04034b50) damaged();
    entries.push(entry);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  if (!entries.length) damaged();
  return entries;
}

/** The first bytes of one entry. */
function zipHead(bytes, entry) {
  const from = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
  const packed = bytes.subarray(from, from + Math.min(entry.packed, 8192));
  if (entry.method === 0) return packed;
  if (entry.method !== 8) return refuse('This archive uses a compression type that cannot be checked.');
  try {
    return zlib.inflateRawSync(packed, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 16 * MB });
  } catch {
    return refuse('This archive is damaged.');
  }
}

function isProgram(head) {
  if (!head || head.length < 4) return false;
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // Windows
  return [0x7f454c46, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(head.readUInt32BE(0)) || head.toString('latin1', 0, 2) === '#!';
}

function checkZip(bytes, ext) {
  const entries = zipEntries(bytes);
  let total = 0;
  for (const e of entries) {
    if (e.flags & 1) refuse('Password-protected files cannot be checked. Remove the password and upload it again.');
    const parts = e.name.split(/[\\/]/);
    if (e.name.includes('\0') || /^([\\/]|[a-z]:)/i.test(e.name) || parts.includes('..') || (e.mode & 0xf000) === 0xa000) refuse('This file contains unsafe paths.');
    total += e.size;
    if (total > 500 * MB || (e.size > 10 * MB && e.size > e.packed * 200)) refuse('This file expands to an unsafe size.');
    if (e.name.endsWith('/')) continue;
    if (/vbaProject|vbaData|activeX/i.test(e.name) || (ext !== 'zip' && /^(Basic|Scripts)\//.test(e.name))) refuse('This document contains macros. Save it without macros and upload it again.');
    const inner = path.extname(e.name.toLowerCase().replace(/[.\s]+$/, ''));
    if (ext === 'zip' && NOT_IN_ZIP.has(inner)) refuse(`This archive contains a file that is not allowed (${inner}).`);
    if (e.size > 0 && isProgram(zipHead(bytes, e))) refuse('This file contains a program.');
  }
  const names = new Set(entries.map((e) => e.name));
  const main = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[ext];
  if (main && !(names.has('[Content_Types].xml') && names.has(main))) refuse(`This file is not a valid ${ext.toUpperCase()} file.`);
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') {
    const entry = entries.find((e) => e.name === 'mimetype');
    if (!entry || zipHead(bytes, entry).toString('latin1').trim() !== TYPES[ext].mime) refuse(`This file is not a valid ${ext.toUpperCase()} file.`);
  }
}

// ---- other documents ------------------------------------------------------------------------

function checkOle(bytes, ext) {
  const has = (name) => bytes.includes(Buffer.from(name, 'utf16le'));
  const right = { doc: has('WordDocument'), xls: has('Workbook') || has('Book\0'), ppt: has('PowerPoint Document') }[ext];
  if (!right) refuse(`This file is not a valid ${ext.toUpperCase()} file.`);
  if (has('_VBA_PROJECT')) refuse('This document contains macros. Save it without macros and upload it again.');
}

function checkText(bytes) {
  if (!matchesSignature('text', bytes.subarray(0, 4096))) refuse('This file is not plain text.');
  // Any encoding, but no control bytes (tab, line breaks and escape excepted) anywhere in the file.
  for (const b of bytes) if (b < 9 || (b > 13 && b < 32 && b !== 27)) refuse('This file is not plain text.');
}

// ---- video and audio ------------------------------------------------------------------------

/** Top-level boxes of an MP4/MOV file: every box must fit and the media must be there. */
async function checkIso(handle, size) {
  const seen = new Set();
  let brand = '';
  let at = 0;
  for (let i = 0; at < size; i += 1) {
    if (i > 20000) refuse('This video could not be checked.');
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, at);
    if (bytesRead < 8) refuse('This video is damaged or incomplete.');
    let length = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (length === 1) length = Number(head.readBigUInt64BE(8));
    if (length === 0) length = size - at;
    if (length < 8 || at + length > size) refuse('This video is damaged or incomplete.');
    if (i === 0) brand = head.toString('latin1', 8, 12);
    seen.add(type);
    at += length;
  }
  if (/^(heic|heix|hevc|mif1|msf1|avif|avis)$/.test(brand)) refuse('HEIC and AVIF photos cannot be used. Save the photo as JPEG or PNG.');
  if (!seen.has('moov') || !(seen.has('mdat') || seen.has('moof'))) refuse('This video is damaged or incomplete.');
  if (brand === 'qt  ') return 'mov';
  return brand.startsWith('M4A') ? 'm4a' : 'mp4';
}

/** What the first bytes say the file is ('' = nothing known, perhaps text). */
function detect(head) {
  const image = detectImage(head);
  if (image) return image.ext;
  for (const sig of ['pdf', 'ole', 'zip', 'rtf', 'iso', 'ebml']) if (matchesSignature(sig, head)) return sig === 'ebml' ? 'webm' : sig;
  const text = head.toString('latin1', 0, 12);
  if (text.startsWith('OggS')) return 'ogg';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE') return 'wav';
  if (text.startsWith('ID3') || (head.length > 2 && head[0] === 0xff && (head[1] & 0xe6) === 0xe2)) return 'mp3';
  return '';
}

/** The extension the file may carry, given what is inside and what it was called ('' = refused). */
function settle(found, named) {
  if (found === 'ole' || found === 'zip') return TYPES[named] && TYPES[named].sig === found ? named : found === 'zip' && !named ? 'zip' : '';
  if (found === 'iso') return ['mp4', 'm4v', 'mov', 'm4a'].includes(named) ? named : named ? '' : 'mp4';
  if (!found) return TYPES[named] && TYPES[named].sig === 'text' ? named : '';
  if (IMAGE_EXTS.includes(found)) return TYPES[named] || AUDIO[named] || ACTIVE_EXTENSIONS.has(`.${named}`) ? '' : found; // .jfif and the like are fine
  if ((found === 'ogg' && named === 'oga') || (found === 'webm' && named === 'weba')) return found;
  return !named || named === found ? found : '';
}

/**
 * Checks a temporary upload. `allow` lists the extensions this route accepts. Images are rewritten
 * in place. Resolves to { ok, ext, mime, kind, bytes, fileName } (fileName: random) or
 * { ok: false, status, code, error }.
 */
async function inspectUpload(filePath, { name = '', allow }) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (!size) return { ok: false, status: 400, code: 'empty_file', error: 'The file is empty.' };
    const head = Buffer.alloc(Math.min(size, 4096));
    await handle.read(head, 0, head.length, 0);
    const found = detect(head);
    const named = namedExt(name);
    let ext = settle(found, named);
    if (!ext || !allow.includes(ext)) refuse('What is inside this file does not match an allowed file type. It may be damaged or renamed.');
    let bytes = size;
    if (found === 'iso') {
      const inside = await checkIso(handle, size);
      if (!named) ext = inside;
      if (!allow.includes(ext)) refuse('This file type is not allowed here.');
    } else if (found === 'webm') {
      // EBML DocType element (0x4282) with the value "webm".
      if (!head.subarray(0, 256).includes(Buffer.from([0x42, 0x82])) || !head.subarray(0, 256).includes('webm')) refuse('This is not a valid WebM file.');
    } else if (!AUDIO[ext]) {
      if (size > MAX_INSPECT_BYTES) return { ok: false, status: 413, code: 'file_too_large', error: 'Files of this type can be at most 25 MB.' };
      const content = await fs.promises.readFile(filePath);
      if (IMAGE_MIME[ext]) {
        const clean = await rewriteImage(content, ext);
        await fs.promises.writeFile(filePath, clean);
        bytes = clean.length;
      } else if (found === 'pdf') checkPdf(content);
      else if (found === 'zip') checkZip(content, ext);
      else if (found === 'ole') checkOle(content, ext);
      else if (found === 'rtf') {
        if (/\\(object|objdata|objemb|objocx)/i.test(content.toString('latin1'))) refuse('This RTF document contains embedded objects. Remove them and upload it again.');
      } else checkText(content);
    }
    const mime = IMAGE_MIME[ext] || AUDIO[ext] || TYPES[ext].mime;
    return { ok: true, ext, mime, kind: IMAGE_MIME[ext] ? 'image' : AUDIO[ext] ? 'audio' : TYPES[ext].kind, bytes, fileName: randomFileName(ext) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, status: 415, code: 'content_mismatch', error: error.message };
    throw error;
  } finally {
    await handle.close();
  }
}

module.exports = { CHAT_EXTS, IMAGE_EXTS, inspectUpload, randomFileName };
