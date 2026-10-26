/**
 * Community news responses.
 * Reader lists stay on the stored document. Callers receive their own isRead flag.
 */

const COMMUNITY_NEWS_CLIENT_ERROR = 'Internal server error';

function presentCommunityNews(item, userId) {
  const source = item && typeof item === 'object' ? item : {};
  const readBy = Array.isArray(source.readBy) ? source.readBy.map((id) => String(id)) : [];
  const viewer = userId == null ? '' : String(userId);
  return {
    _id: source._id != null ? String(source._id) : '',
    title: typeof source.title === 'string' ? source.title : '',
    description: typeof source.description === 'string' ? source.description : '',
    category: typeof source.category === 'string' ? source.category : '',
    content: typeof source.content === 'string' ? source.content : null,
    link: typeof source.link === 'string' ? source.link : null,
    createdAt: source.createdAt == null ? null : source.createdAt,
    createdBy: typeof source.createdBy === 'string' ? source.createdBy : null,
    isRead: viewer !== '' && readBy.includes(viewer),
  };
}

function logCommunityNewsFailure(event) {
  console.error(JSON.stringify({ event, result: 'failed' }));
}

module.exports = {
  COMMUNITY_NEWS_CLIENT_ERROR,
  presentCommunityNews,
  logCommunityNewsFailure,
};
