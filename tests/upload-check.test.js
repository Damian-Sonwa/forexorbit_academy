'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
const { CHAT_EXTS, IMAGE_EXTS, inspectUpload, randomFileName } = require('../lib/upload-check');

async function check(bytes, name, allow = CHAT_EXTS) {
  const file = path.join(os.tmpdir(), `fo-upload-check-${randomFileName('')}`);
  fs.writeFileSync(file, bytes);
  try {
    const result = await inspectUpload(file, { name, allow });
    return { ...result, stored: fs.readFileSync(file) };
  } finally {
    fs.unlinkSync(file);
  }
}
const refused = async (bytes, name, pattern, allow) => {
  const r = await check(bytes, name, allow);
  assert.equal(r.ok, false, `${name} should be refused`);
  assert.equal(r.status, 415);
  assert.match(r.error, pattern);
};
const accepted = async (bytes, name, ext) => {
  const r = await check(bytes, name);
  assert.equal(r.ok, true, `${name}: ${r.error}`);
  assert.equal(r.ext, ext);
  assert.match(r.fileName, new RegExp(`^[0-9a-f]{32}\\.${ext}$`));
  return r;
};

/** A small ZIP from { name: content }. */
function zip(files, { flags = 0, size } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const packed = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(flags, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(flags, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(size || data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const DOCX = { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' };
const pdf = (body = '') => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${body}\ntrailer<<>>\n%%EOF\n`, 'latin1');
const box = (type, body = '') => { const b = Buffer.from(body); const h = Buffer.alloc(8); h.writeUInt32BE(8 + b.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, b]); };

test('images are decoded and rewritten: hidden and appended data is gone', async () => {
  const base = sharp({ create: { width: 60, height: 40, channels: 3, background: '#c24e00' } });
  for (const [format, ext] of [['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp'], ['gif', 'gif']]) {
    const source = await base.clone().withExif({ IFD0: { Copyright: 'SECRET-LOCATION' } }).toFormat(format).toBuffer();
    const r = await accepted(Buffer.concat([source, Buffer.from('<script>payload</script>')]), `my holiday.${ext}`, ext);
    assert.equal(r.stored.includes('payload') || r.stored.includes('SECRET-LOCATION'), false, ext);
    assert.equal((await sharp(r.stored).metadata()).width, 60);
  }
  const png = await base.clone().png().toBuffer();
  await accepted(png, 'wrong-image-name.jpg', 'png');
  await accepted(png, 'chart.jfif', 'png');
  await refused(png, 'notes.pdf', /does not match/);
  await refused(png, 'picture.html', /does not match/);
  await refused(png.subarray(0, 40), 'cut.png', /damaged/);
  await refused(Buffer.from('<svg xmlns="x"/>'), 'a.png', /does not match/);
  await refused(pdf(), 'a.pdf', /does not match/, IMAGE_EXTS);
});

test('animated GIFs stay animated', async () => {
  const frame = (c) => sharp({ create: { width: 8, height: 8, channels: 3, background: c } }).png().toBuffer();
  const gif = await sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } }).gif().toBuffer();
  const r = await accepted(gif, 'a.gif', 'gif');
  assert.equal((await sharp(r.stored, { animated: true }).metadata()).pages, 2);
});

test('PDFs: scripts (also escaped or inside object streams), encryption and truncation are refused', async () => {
  await accepted(pdf(), 'notes.pdf', 'pdf');
  await refused(pdf('2 0 obj<</S/JavaScript/JS(app.alert(1))>>endobj'), 'a.pdf', /scripts/);
  await refused(pdf('2 0 obj<</S/Java#53cript>>endobj'), 'a.pdf', /scripts/);
  await refused(pdf('2 0 obj<</S/Launch/F(cmd.exe)>>endobj'), 'a.pdf', /scripts/);
  const objStm = (t) => pdf(`2 0 obj<</Type/ObjStm/Filter/FlateDecode>>stream\n${zlib.deflateSync(Buffer.from(t)).toString('latin1')}\nendstream endobj`);
  await accepted(objStm('<</S/URI>>'), 'a.pdf', 'pdf');
  await refused(objStm('<</S/JavaScript>>'), 'a.pdf', /scripts/);
  await refused(pdf('trailer<</Encrypt 5 0 R>>'), 'a.pdf', /Password/);
  await refused(Buffer.from('%PDF-1.4\n1 0 obj'), 'a.pdf', /incomplete/);
  await refused(Buffer.concat([pdf(), Buffer.from('PK\u0003\u0004 extra')]), 'a.pdf', /incomplete|extra/);
});

test('Office files and archives: the real kind, no macros, programs, bombs or unsafe paths', async () => {
  await accepted(zip(DOCX), 'plan.docx', 'docx');
  await refused(zip(DOCX), 'plan.xlsx', /not a valid XLSX/);
  await refused(zip({ 'a.txt': 'x' }), 'plan.docx', /not a valid DOCX/);
  await refused(zip({ ...DOCX, 'word/vbaProject.bin': 'x' }), 'plan.docx', /macros/);
  await accepted(zip({ 'notes.txt': 'hello' }), 'files.zip', 'zip');
  await refused(zip({ 'run.exe': 'x' }), 'files.zip', /not allowed/);
  await refused(zip({ 'photo.txt': 'MZ\u0090\u0000 program' }), 'files.zip', /program/);
  await refused(zip({ '../up.txt': 'x' }), 'files.zip', /unsafe paths/);
  await refused(zip({ 'a.txt': 'x' }, { flags: 1 }), 'files.zip', /Password/);
  await refused(zip({ 'a.txt': 'x' }, { size: 900 * 1024 * 1024 }), 'files.zip', /unsafe size/);
  await refused(zip({ 'a.txt': 'x' }).subarray(0, 60), 'files.zip', /damaged/);
  const odt = { mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' };
  await accepted(zip(odt), 'a.odt', 'odt');
  await refused(zip(odt), 'a.ods', /not a valid ODS/);
  const ole = (...names) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600), ...names.map((n) => Buffer.from(n, 'utf16le'))]);
  await accepted(ole('WordDocument'), 'a.doc', 'doc');
  await refused(ole('WordDocument'), 'a.xls', /not a valid XLS/);
  await refused(ole('WordDocument', '_VBA_PROJECT'), 'a.doc', /macros/);
  await refused(Buffer.from('{\\rtf1 {\\object\\objdata 00}}'), 'a.rtf', /embedded/);
});

test('text, video, audio and programs', async () => {
  await accepted(Buffer.from('date,price\n1,2\n'), 'a.csv', 'csv');
  await refused(Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]), 'a.txt', /plain text/);
  await refused(Buffer.from('<!doctype html><script>'), 'a.txt', /plain text/);
  const mp4 = Buffer.concat([box('ftyp', 'isom\0\0\0\0'), box('moov', 'x'), box('mdat', 'data')]);
  await accepted(mp4, 'a.mp4', 'mp4');
  await refused(mp4.subarray(0, mp4.length - 2), 'a.mp4', /incomplete/);
  await refused(Buffer.concat([mp4, Buffer.from('trailing bytes here')]), 'a.mp4', /incomplete/);
  await refused(mp4, 'a.pdf', /does not match/);
  await refused(Buffer.concat([box('ftyp', 'heic\0\0\0\0'), box('mdat')]), 'a.mp4', /HEIC/);
  await accepted(Buffer.from('OggS\0 voice'), 'voice.ogg', 'ogg');
  for (const name of ['a.pdf', 'a.png', 'a.txt', 'a.mp3', 'a.exe', '']) await refused(Buffer.from('MZ\u0090\u0000\u0003 program'), name, /does not match|plain text/);
  assert.equal((await check(Buffer.alloc(0), 'a.png')).code, 'empty_file');
});

test('every upload route looks inside the file, and the uploader\'s file name is not stored', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const routes = ['pages/api/certificates/upload.ts', 'pages/api/community/messages/upload.ts', 'pages/api/consultations/messages/upload.ts', 'pages/api/courses/[id]/assets.ts', 'pages/api/demo-trading/journal/upload.ts', 'pages/api/practical-tasks/[id]/evidence.ts', 'lib/course-image-upload.ts'];
  for (const f of routes) {
    const src = read(f);
    const at = src.indexOf('await inspectUpload(');
    const store = src.search(/await (uploadImageFromPath|storeChatAttachment|storeCourseAsset|uploadPrivateImageFromPath|storeImage|putObject)\(/);
    assert.ok(at > 0 && (store < 0 || at < store), f);
    assert.doesNotMatch(src, /(content|fileName|originalFilename): file\.originalFilename \|\| '/, f);
    assert.doesNotMatch(src, /keepExtensions: true/, f);
  }
  // Any new multipart route must be added here (the profile photo has its own re-encoder).
  const found = [];
  const walk = (dir) => { for (const e of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|js)$/.test(p) && /formidable\(\{/.test(read(p))) found.push(p); } };
  walk('pages'); walk('lib');
  assert.deepEqual(found.sort(), [...routes, 'pages/api/upload/profile.ts'].sort());
  assert.match(read('pages/api/upload/profile.ts'), /MAX_PHOTO_BYTES = 2 \* 1024 \* 1024/);
  assert.match(read('pages/api/upload/profile.ts'), /reencodeProfileImage\(/);
});
