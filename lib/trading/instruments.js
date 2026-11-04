'use strict';

/**
 * Instruments, account rules and the financial formulas of the practice simulator (Phase 10, G1).
 * Pure. All inputs and outputs are BigInt (lib/trading/money.js). Binding rules are in
 * docs/audits/phase-10-practice-trading.md, section 15.
 *
 * Account currency is USD. Pairs are either quoted in USD (EUR_USD: P&L is already USD) or based in
 * USD (USD_JPY: P&L is in JPY and converts to USD at the price of the same pair). No cross rates
 * are needed, which is why the instrument list has only these six.
 */

const { MONEY_ONE, PRICE_ONE, divideHalfEven, parseMoney, percentOf } = require('./money');

const ACCOUNT_CURRENCY = 'USD';
const STARTING_BALANCE = parseMoney('10000.00');
const LEVERAGE = 30n;
const MIN_UNITS = 1000n;
const MAX_UNITS = 10000000n;
const MAX_RISK_PER_TRADE_PERCENT = 2n;
const MAX_TOTAL_RISK_PERCENT = 5n;
/** Margin level, in hundredths of a percent. */
const MARGIN_CALL_LEVEL = 10000n;
const STOP_OUT_LEVEL = 5000n;

const INSTRUMENTS = Object.freeze({
  EUR_USD: Object.freeze({ id: 'EUR_USD', label: 'EUR/USD', base: 'EUR', quote: 'USD', priceDecimals: 5, pipDecimals: 4 }),
  GBP_USD: Object.freeze({ id: 'GBP_USD', label: 'GBP/USD', base: 'GBP', quote: 'USD', priceDecimals: 5, pipDecimals: 4 }),
  AUD_USD: Object.freeze({ id: 'AUD_USD', label: 'AUD/USD', base: 'AUD', quote: 'USD', priceDecimals: 5, pipDecimals: 4 }),
  USD_JPY: Object.freeze({ id: 'USD_JPY', label: 'USD/JPY', base: 'USD', quote: 'JPY', priceDecimals: 3, pipDecimals: 2 }),
  USD_CAD: Object.freeze({ id: 'USD_CAD', label: 'USD/CAD', base: 'USD', quote: 'CAD', priceDecimals: 5, pipDecimals: 4 }),
  USD_CHF: Object.freeze({ id: 'USD_CHF', label: 'USD/CHF', base: 'USD', quote: 'CHF', priceDecimals: 5, pipDecimals: 4 }),
});

const instrumentOf = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(INSTRUMENTS, id) ? INSTRUMENTS[id] : null);

/** One pip as a price (BigInt at PRICE_SCALE): 0.0001 -> 10n, JPY 0.01 -> 1000n. */
const pipSize = (instrument) => 10n ** BigInt(5 - instrument.pipDecimals);

/** True when a price has no more decimals than the instrument quotes. */
function priceFitsInstrument(price, instrument) {
  return price % (10n ** BigInt(5 - instrument.priceDecimals)) === 0n;
}

/**
 * An amount in the instrument's quote currency, at PRICE_SCALE x units, to USD cents, half-even.
 * `rate` is the pair's own price, used only for USD-based pairs.
 */
function quoteAmountToMoney(amount, instrument, rate) {
  if (instrument.quote === ACCOUNT_CURRENCY) return divideHalfEven(amount * MONEY_ONE, PRICE_ONE);
  // amount / PRICE_ONE quote units; / (rate / PRICE_ONE) -> USD; x MONEY_ONE -> cents.
  return divideHalfEven(amount * MONEY_ONE, rate);
}

/** Notional value in USD cents. */
function notional(instrument, units, price) {
  if (instrument.base === ACCOUNT_CURRENCY) return units * MONEY_ONE;
  return divideHalfEven(units * price * MONEY_ONE, PRICE_ONE);
}

/** Margin to hold a position, USD cents, half-even: notional / leverage. */
function requiredMargin(instrument, units, price) {
  return divideHalfEven(notional(instrument, units, price), LEVERAGE);
}

/**
 * Profit or loss of `units` moved from entry to exit, USD cents, half-even, rounded once.
 * A buy gains when exit is above entry; a sell gains when it is below.
 */
function profitLoss({ instrument, side, units, entry, exit }) {
  const move = side === 'buy' ? exit - entry : entry - exit;
  return quoteAmountToMoney(move * units, instrument, exit);
}

/** Loss if the stop-loss is hit, as a positive amount of USD cents. */
function plannedRisk({ instrument, side, units, entry, stopLoss }) {
  const pl = profitLoss({ instrument, side, units, entry, exit: stopLoss });
  return pl < 0n ? -pl : 0n;
}

/** The price a position is valued or closed at: a buy sells at the bid, a sell buys at the ask. */
const exitPriceOf = (side, quote) => (side === 'buy' ? quote.bid : quote.ask);
/** The price an order opens at: a buy pays the ask, a sell receives the bid. */
const entryPriceOf = (side, quote) => (side === 'buy' ? quote.ask : quote.bid);

/**
 * Account figures from the stored balance and open positions at current quotes. Returns null for
 * equity and everything derived from it when any position has no valid quote: an unknown value is
 * never replaced by an old one.
 */
function accountFigures({ balance, positions, quotes }) {
  let usedMargin = 0n;
  let unrealized = 0n;
  let priced = true;
  for (const position of positions) {
    usedMargin += position.margin;
    const quote = quotes[position.instrument];
    if (!quote) {
      priced = false;
      continue;
    }
    unrealized += profitLoss({ instrument: INSTRUMENTS[position.instrument], side: position.side, units: position.units, entry: position.entry, exit: exitPriceOf(position.side, quote) });
  }
  if (!priced) return { balance, usedMargin, unrealized: null, equity: null, freeMargin: null, marginLevel: null };
  const equity = balance + unrealized;
  return {
    balance,
    usedMargin,
    unrealized,
    equity,
    freeMargin: equity - usedMargin,
    marginLevel: usedMargin > 0n ? percentOf(equity, usedMargin) : null,
  };
}

/** Limits as money: percent of equity, truncated by half-even at cents. */
const percentOfMoney = (amount, percent) => divideHalfEven(amount * percent, 100n);

module.exports = {
  ACCOUNT_CURRENCY,
  INSTRUMENTS,
  LEVERAGE,
  MARGIN_CALL_LEVEL,
  MAX_RISK_PER_TRADE_PERCENT,
  MAX_TOTAL_RISK_PERCENT,
  MAX_UNITS,
  MIN_UNITS,
  STARTING_BALANCE,
  STOP_OUT_LEVEL,
  accountFigures,
  entryPriceOf,
  exitPriceOf,
  instrumentOf,
  notional,
  percentOfMoney,
  pipSize,
  plannedRisk,
  priceFitsInstrument,
  profitLoss,
  requiredMargin,
};
