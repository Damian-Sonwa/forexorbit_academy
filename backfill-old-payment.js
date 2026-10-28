/**
 * Retired. This script granted full-course access and wrote payment rows without verifying the
 * charge with Paystack, using a hard-coded default reference and no dry run.
 *
 * Charges that cannot be matched to a checkout are now recorded in `paymentExceptions` for
 * review. Resolve them through a reviewed, provider-verified process instead.
 */

console.error('backfill-old-payment.js is disabled. See docs/audits/course-purchase-security-audit.md.');
process.exit(1);
