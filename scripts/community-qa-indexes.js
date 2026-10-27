/**
 * Prints the community Q&A index plan.
 * Does not connect to a database and does not create indexes.
 */

const { COMMUNITY_QA_INDEXES } = require('../lib/community-qa');

if (process.argv.includes('--apply')) {
  console.error('Index creation is not authorized from this script.');
  process.exit(1);
}

COMMUNITY_QA_INDEXES.forEach((index) => {
  console.log(`${index.collection} ${index.name} unique=${index.unique === true}`);
});
