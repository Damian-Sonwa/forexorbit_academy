/** Display-size Cloudinary URLs for course covers (lib/cloudinary-url.js). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { cloudinaryDisplayUrl } = require('../lib/cloudinary-url');

test('an original Cloudinary upload gets a resized, auto-format transformation', () => {
  assert.equal(
    cloudinaryDisplayUrl('https://res.cloudinary.com/demo/image/upload/v1712345678/courses/cover.png'),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_960/v1712345678/courses/cover.png'
  );
  assert.equal(
    cloudinaryDisplayUrl('https://res.cloudinary.com/demo/image/upload/cover.jpg', 640),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/cover.jpg'
  );
});

test('URLs that already have a transformation are left alone', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1/cover.png';
  assert.equal(cloudinaryDisplayUrl(url), url);
});

test('local, other-host, video and invalid values are returned unchanged', () => {
  for (const value of [
    '/images/catalog/digital-forex.webp',
    'https://images.example.com/cover.png',
    'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
    'http://res.cloudinary.com/demo/image/upload/v1/cover.png',
    '',
    undefined,
  ]) {
    assert.equal(cloudinaryDisplayUrl(value), value);
  }
});
