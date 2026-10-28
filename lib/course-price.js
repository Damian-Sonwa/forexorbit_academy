'use strict';

/**
 * The one authoritative full-course price. Safe to import from browser code.
 * Paystack amounts are in kobo (1 NGN = 100 kobo).
 */
const COURSE_PRICE_KOBO = 1000000;
const COURSE_CURRENCY = 'NGN';

function formatNairaFromKobo(kobo) {
  const naira = Math.round(Number(kobo) / 100);
  return `₦${String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const COURSE_PRICE_LABEL = formatNairaFromKobo(COURSE_PRICE_KOBO);

module.exports = {
  COURSE_PRICE_KOBO,
  COURSE_CURRENCY,
  COURSE_PRICE_LABEL,
  formatNairaFromKobo,
};
