#!/usr/bin/env node
'use strict';

/**
 * Retired in Phase 15. This script wrote plain JSON (ObjectIds, dates and Decimal128 ledger amounts
 * lost their types), saved no indexes.
 * Use scripts/db-backup.js and scripts/db-restore.js (lib/db-backup.js) instead.
 */

console.error('scripts/backup-data.js is retired. Use scripts/db-backup.js and scripts/db-restore.js (see docs/audits/phase-15-production-readiness.md).');
process.exit(1);
