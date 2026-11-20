/**
 * The connection string for operator scripts, by the project convention (lib/mongodb.js and the index
 * scripts): MONGO_URI, else MONGODB_URI, trimmed. Returns '' when neither is set. Never logs it.
 */
function mongoUri(env = process.env) {
  return String(env.MONGO_URI || env.MONGODB_URI || '').trim();
}

const MISSING_URI = 'MONGO_URI (or MONGODB_URI) is not set.';

module.exports = { MISSING_URI, mongoUri };
