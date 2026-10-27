/**
 * Prints the consultation slot index plan.
 * Does not connect to a database and does not create indexes.
 */

const indexes = [
  { collection: 'consultationRequests', name: 'consultation_active_slot', unique: true },
];

if (process.argv.includes('--apply')) {
  console.error('Index creation is not authorized from this script.');
  process.exit(1);
}

indexes.forEach((index) => {
  console.log(`${index.collection} ${index.name} unique=${index.unique}`);
});
