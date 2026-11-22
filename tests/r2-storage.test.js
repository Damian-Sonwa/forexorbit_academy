/**
 * Cloudflare R2 storage: request signing (checked against AWS's published example), the R2 client
 * against an S3-compatible test double, image type detection, and the builder's image link fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('../lib/r2-storage');
const { detectImage } = require('../lib/course-asset-files');
const { startFakeR2 } = require('../scripts/acceptance/fake-r2');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('SigV4 presigning matches the example in the AWS documentation', () => {
  const url = R.presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    expires: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(url.split('X-Amz-Signature=')[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});

test('R2 is used only when fully configured; the public bucket and the private bucket are separate', () => {
  assert.equal(R.r2ImagesConfig({}), null);
  assert.equal(R.r2ImagesConfig({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_IMAGES_BUCKET: 'img' }), null, 'needs the public address');
  const images = R.r2ImagesConfig({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_IMAGES_BUCKET: 'img', R2_PUBLIC_BASE_URL: 'https://pub-1.r2.dev/' });
  assert.deepEqual([images.endpoint, images.bucket, images.publicBaseUrl], ['https://acc.r2.cloudflarestorage.com', 'img', 'https://pub-1.r2.dev']);
  assert.equal(R.r2FilesConfig({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_IMAGES_BUCKET: 'img' }), null, 'files need their own (private) bucket');
  assert.equal(R.publicUrl(images, 'course-images/a b.png'), 'https://pub-1.r2.dev/course-images/a%20b.png');
});

test('upload, signed download, expiry, tampering and delete against an S3-compatible store', async () => {
  const fake = await startFakeR2();
  const tmp = path.join(os.tmpdir(), `fo-r2-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, '%PDF-1.4 test');
  try {
    const files = R.r2FilesConfig(fake.env);
    await R.putObject(files, 'course-files/plan.pdf', tmp, { contentType: 'application/pdf' });
    assert.equal(fake.objects.get('course-files/plan.pdf').type, 'application/pdf');
    const link = R.signedGetUrl(files, 'course-files/plan.pdf', { filename: 'Trading "plan".pdf' });
    const got = await fetch(link);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), '%PDF-1.4 test');
    assert.equal(got.headers.get('content-disposition'), 'attachment; filename="Trading plan.pdf"', 'quotes removed from the name');
    const tampered = link.replace('plan.pdf', 'other.pdf');
    assert.equal((await fetch(tampered)).status, 403, 'a changed path breaks the signature');
    const expired = R.objectUrl(files, 'GET', 'course-files/plan.pdf', { expires: 60, now: new Date(Date.now() - 120000) });
    assert.equal((await fetch(expired)).status, 403, 'expired links are refused');
    const wrongKey = R.signedGetUrl({ ...files, secretAccessKey: 'not-the-secret' }, 'course-files/plan.pdf');
    assert.equal((await fetch(wrongKey)).status, 403);
    await R.deleteObject(files, 'course-files/plan.pdf');
    assert.equal(fake.objects.has('course-files/plan.pdf'), false);
    const bad = { ...files, secretAccessKey: 'wrong' };
    await assert.rejects(R.putObject(bad, 'x', tmp), (e) => e.status === 403);
  } finally {
    fs.rmSync(tmp, { force: true });
    await fake.close();
  }
});

test('only real images are accepted for the public bucket', () => {
  assert.deepEqual(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), { ext: 'jpg', mime: 'image/jpeg' });
  assert.equal(detectImage(Buffer.from('GIF89a')).mime, 'image/gif');
  assert.equal(detectImage(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')).mime, 'image/webp');
  assert.equal(detectImage(Buffer.from('<html><script>')), null);
  assert.equal(detectImage(Buffer.from('<svg xmlns=')), null, 'SVG (can carry script) is never accepted');
});

test('the builder accepts image links and uses R2 before Cloudinary', () => {
  const editors = read('components/builder/BlockEditors.tsx');
  assert.match(editors, /data-testid="image-link"/);
  assert.match(read('components/builder/CoursePanels.tsx'), /data-testid="cover-link"/);
  const upload = read('lib/course-image-upload.ts');
  assert.ok(upload.indexOf('if (r2) {') < upload.indexOf('uploadImageFromPath(file.filepath, folder)'), 'R2 is tried first');
  assert.match(upload, /const kind = detectImage\(head\);/);
  assert.match(upload, /contentType: kind\.mime/, 'the stored type comes from the bytes, not the browser');
  assert.match(upload, /Paste a link to the image instead\./);
  const assets = read('lib/course-assets.ts');
  assert.match(assets, /if \(r2FilesConfig\(\)\) return 'r2';/);
  // Image links are validated on the server like every other link.
  const C = require('../lib/course-content');
  assert.equal(C.checkBlocks([{ id: 'img00001', type: 'image', url: 'javascript:alert(1)', alt: '' }]).ok, false);
  assert.equal(C.checkBlocks([{ id: 'img00001', type: 'image', url: 'https://images.example.com/chart.png', alt: 'Chart' }]).ok, true);
});
