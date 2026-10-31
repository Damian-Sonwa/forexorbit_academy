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

/** Naira with kobo, e.g. ₦10,253.81. */
function formatNairaAndKobo(kobo) {
  const value = Math.round(Number(kobo));
  const naira = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${naira}.${String(value % 100).padStart(2, '0')}`;
}

const COURSE_PRICE_LABEL = formatNairaFromKobo(COURSE_PRICE_KOBO);

/**
 * The Paystack account passes transaction fees to the customer, so Paystack adds its fee on top of
 * the course price at checkout. Must match the dashboard setting (Settings → Preferences). For a
 * Nigerian (local) card Paystack charges 1.5% + ₦100 of the total it collects, rounded up to the kobo:
 * total = ceil((price + ₦100) / 0.985). Test mode on 31 October 2026 charged exactly this for
 * ₦10,000 (1,025,381 kobo, fees 25,381). Paystack's fee cap and small-amount waiver are not modelled;
 * neither applies at this price. International cards and other channels cost more and are not estimated.
 * Display only: the checkout total Paystack shows is authoritative, and payment verification never uses
 * this estimate (it accepts the price plus whatever fee Paystack reports; see paysExpectedAmount).
 */
const CUSTOMER_PAYS_PAYSTACK_FEES = true;
const PAYSTACK_LOCAL_RATE = 0.015;
const PAYSTACK_LOCAL_FLAT_KOBO = 10000;

function localCardTotalKobo(priceKobo) {
  // Integer arithmetic: (price + flat) * 1000 / 985, rounded up.
  return Math.ceil(((Number(priceKobo) + PAYSTACK_LOCAL_FLAT_KOBO) * 1000) / (1000 - PAYSTACK_LOCAL_RATE * 1000));
}

const COURSE_LOCAL_CARD_TOTAL_KOBO = CUSTOMER_PAYS_PAYSTACK_FEES ? localCardTotalKobo(COURSE_PRICE_KOBO) : COURSE_PRICE_KOBO;
const COURSE_LOCAL_CARD_FEE_KOBO = COURSE_LOCAL_CARD_TOTAL_KOBO - COURSE_PRICE_KOBO;

module.exports = {
  COURSE_PRICE_KOBO,
  COURSE_CURRENCY,
  COURSE_PRICE_LABEL,
  CUSTOMER_PAYS_PAYSTACK_FEES,
  COURSE_LOCAL_CARD_TOTAL_KOBO,
  COURSE_LOCAL_CARD_FEE_KOBO,
  formatNairaFromKobo,
  formatNairaAndKobo,
  localCardTotalKobo,
};
