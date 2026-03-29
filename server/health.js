/**
 * Shared MongoDB ping for plain Node scripts.
 * Pass an already-connected DB from your MongoClient (do not open a new client per ping).
 */

async function checkMongo(existingDb) {
  try {
    if (!existingDb) return false;

    await existingDb.command({ ping: 1 });
    return true;
  } catch (e) {
    console.error('DB ping failed', e.message);
    return false;
  }
}

module.exports = { checkMongo };
