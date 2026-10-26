/**
 * Community news responses. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  COMMUNITY_NEWS_CLIENT_ERROR,
  presentCommunityNews,
} = require('../lib/community-news');

const ROUTES = [
  'pages/api/community/news.ts',
  'pages/api/community/news/[id].ts',
  'pages/api/community/news/mark-read.ts',
];

test('a news reader sees isRead and not the readBy user list', () => {
  const view = presentCommunityNews({
    _id: '507f1f77bcf86cd799439011',
    title: 'Market open',
    description: 'A short note',
    category: 'markets',
    content: 'Public news copy',
    link: 'https://example.com/story',
    createdAt: '2026-10-26T00:00:00.000Z',
    createdBy: 'author-1',
    readBy: ['author-1', 'reader-2', 'reader-3'],
    internalNote: 'provider failure details',
  }, 'reader-2');

  assert.equal(view.isRead, true);
  assert.equal(view.createdBy, 'author-1');
  assert.equal(view.title, 'Market open');
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'readBy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'internalNote'), false);
  assert.equal(JSON.stringify(view).includes('reader-3'), false);
});

test('another reader is not marked as having read the item', () => {
  const view = presentCommunityNews({
    _id: '507f1f77bcf86cd799439011',
    title: 'Market open',
    readBy: ['reader-2'],
  }, 'reader-9');
  assert.equal(view.isRead, false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'readBy'), false);
});

test('news failures return a stable client error and the feed does not return readBy', () => {
  assert.equal(COMMUNITY_NEWS_CLIENT_ERROR, 'Internal server error');
  for (const relativePath of ROUTES) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.equal(source.includes('error.message'), false, relativePath);
    assert.equal(source.includes('unexpectedBody'), true, relativePath);
  }
  const feed = fs.readFileSync(path.join(__dirname, '..', 'pages/api/community/news.ts'), 'utf8');
  assert.equal(feed.includes('readBy'), false);
});
