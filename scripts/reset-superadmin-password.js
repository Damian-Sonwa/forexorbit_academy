/**
 * Disabled on 26 October 2026.
 *
 * This script used to reset a specific account to a password stored in the
 * file, and it could create that account if it was missing. It no longer
 * connects to the database and it no longer changes any password.
 *
 * Do not put a password back into this file. Password resets belong in the
 * normal account-recovery flow, or in a reviewed operator procedure that
 * reads the new password from the environment at runtime.
 */

console.error('reset-superadmin-password.js is disabled. It does not connect to the database or change passwords.');
process.exit(1);
