/**
 * Disabled on 26 October 2026.
 *
 * This script used to create or update a superadmin account with a password
 * stored in the file. It no longer connects to the database and it no longer
 * changes any account. Do not put credentials back into this file.
 *
 * Promoting an operator must be a reviewed database update of users.role
 * after the account already exists. See the remediation addendum in
 * FOREX_ACADEMY_COMPREHENSIVE_AUDIT.md.
 */

console.error('set-superadmin.js is disabled. It does not connect to the database or change accounts.');
process.exit(1);
