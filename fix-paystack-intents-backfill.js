/**
 * Retired. This script deleted payment intents and paystackPayments rows and inserted
 * replacement rows without verifying the charge with Paystack.
 *
 * Historical payment records must not be deleted. Unmatched charges are recorded in
 * `paymentExceptions` for review.
 */

console.error('fix-paystack-intents-backfill.js is disabled. See docs/audits/course-purchase-security-audit.md.');
process.exit(1);
