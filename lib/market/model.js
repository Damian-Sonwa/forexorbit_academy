'use strict';

/**
 * The synthetic price process (model fx-regime-1). Pure and deterministic.
 *
 * Every value is an integer held in a JavaScript number well below 2^53, and only + - * / and floor
 * are used, which IEEE 754 defines exactly. Math.exp, Math.log and Math.random are not used, because
 * only those would differ between machines or runs. The same seed, model, instrument and step always
 * give the same state.
 *
 * Randomness is counter-based: `mix32` (the MurmurHash3 finalizer) hashes (seed, stream, step, draw),
 * so a draw needs no history. A normal variate is the Irwin-Hall sum of 12 uniform 16-bit draws.
 *
 * Each step of each pair:
 *   regime    a Markov regime (range, trend up, trend down, quiet, active) with a drawn duration
 *   target    base volatility x regime factor x session factor
 *   vol       vol' = (b vol + (1000 - a - b) target + a |innovation|) / 1000, which clusters volatility
 *   move      regime drift + reversion to a slow anchor + innovation + any shock
 *   shared    the innovation includes a common US-dollar factor, so USD pairs tend to move together
 *
 * This is a teaching model. Its statistics have not been fitted to any real market.
 */

const MODEL_VERSION = 'fx-regime-1';

/** Prices inside the model carry 8 decimals. */
const MID_SCALE = 100000000;
const STEP_SECONDS = 10;
/** Steps per checkpoint: one hour. */
const CHECKPOINT_STEPS = 360;
const NORMAL_SD = 65536;

const REGIMES = Object.freeze({
  range: Object.freeze({ drift: 0, reversion: 900, vol: 900 }),
  trend_up: Object.freeze({ drift: 40, reversion: 0, vol: 1050 }),
  trend_down: Object.freeze({ drift: -40, reversion: 0, vol: 1050 }),
  quiet: Object.freeze({ drift: 0, reversion: 1400, vol: 500 }),
  active: Object.freeze({ drift: 0, reversion: 300, vol: 1700 }),
});
const REGIME_NAMES = Object.freeze(Object.keys(REGIMES));

/**
 * Pair settings. `points` are the pair's smallest price unit. Volatility is mid units per step. The
 * centre is only the model's own starting level and long-run pull, not a statement of any real rate.
 */
const PAIRS = Object.freeze({
  EUR_USD: Object.freeze({ stream: 11, centre: 1.085, baseVol: 6000, usdSign: -1, spreadPoints: 8, minSpread: 5, maxSpread: 60, shockPips: 25, decimals: 5 }),
  GBP_USD: Object.freeze({ stream: 12, centre: 1.265, baseVol: 8000, usdSign: -1, spreadPoints: 12, minSpread: 8, maxSpread: 80, shockPips: 35, decimals: 5 }),
  AUD_USD: Object.freeze({ stream: 13, centre: 0.66, baseVol: 4500, usdSign: -1, spreadPoints: 10, minSpread: 7, maxSpread: 70, shockPips: 22, decimals: 5 }),
  USD_JPY: Object.freeze({ stream: 14, centre: 148, baseVol: 800000, usdSign: 1, spreadPoints: 10, minSpread: 7, maxSpread: 70, shockPips: 35, decimals: 3 }),
  USD_CAD: Object.freeze({ stream: 15, centre: 1.36, baseVol: 5500, usdSign: 1, spreadPoints: 12, minSpread: 8, maxSpread: 80, shockPips: 25, decimals: 5 }),
  USD_CHF: Object.freeze({ stream: 16, centre: 0.885, baseVol: 5000, usdSign: 1, spreadPoints: 12, minSpread: 8, maxSpread: 80, shockPips: 22, decimals: 5 }),
});

/** Activity per UTC hour, per mille. A fixed shape for variety, not a measurement. */
const HOUR_ACTIVITY = Object.freeze([
  550, 600, 650, 650, 600, 600, 700, 950, 1200, 1250, 1200, 1150, 1250, 1450, 1500, 1400, 1200, 950, 750, 650, 550, 450, 450, 500,
]);
const CLOSED_ACTIVITY = 150;

const midOf = (pair) => Math.round(pair.centre * MID_SCALE);
/** Mid units in one of the pair's price points. */
const pointOf = (pair) => MID_SCALE / 10 ** pair.decimals;
/** Mid units in one pip. */
const pipOf = (pair) => pointOf(pair) * 10;

function mix32(value) {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 32-bit draw for (seed, stream, step, index). */
function draw(seed, stream, step, index) {
  const low = step % 4294967296;
  return mix32(mix32(mix32(seed ^ Math.imul(stream, 0x9e3779b1)) ^ low) ^ Math.imul(index + 1, 0x7feb352d));
}

/** Irwin-Hall normal: mean 0, standard deviation NORMAL_SD, bounded at 6 deviations. */
function normal(seed, stream, step, salt) {
  let sum = 0;
  for (let i = 0; i < 6; i += 1) {
    const value = draw(seed, stream, step, salt + i);
    sum += (value >>> 16) + (value & 0xffff);
  }
  return sum - 6 * 65536 + 6;
}

/** Whole numbers only, for exact arithmetic: a x b / c, rounded down. */
const scaled = (a, b, c) => Math.floor((a * b) / c);

function initialState(instrument, seed) {
  const pair = PAIRS[instrument];
  const mid = midOf(pair);
  return { mid, anchor: mid, vol: pair.baseVol, regime: REGIME_NAMES[draw(seed, pair.stream, 0, 900) % REGIME_NAMES.length], regimeLeft: 1 };
}

function hourActivity(hourOfDay, open) {
  return open ? HOUR_ACTIVITY[hourOfDay] : CLOSED_ACTIVITY;
}

/**
 * One step. `open` says whether the calendar is open at this step. `shock` is any scheduled scenario
 * move, in pips. Returns a new state and never changes the old one.
 */
function advance(state, { instrument, seed, step, hourOfDay, open, shockPips = 0 }) {
  const pair = PAIRS[instrument];
  const { stream } = pair;

  let { regime, regimeLeft } = state;
  regimeLeft -= 1;
  if (regimeLeft <= 0) {
    regime = REGIME_NAMES[draw(seed, stream, step, 30) % REGIME_NAMES.length];
    regimeLeft = 1080 + (draw(seed, stream, step, 31) % 12960); // 3 to 39 hours of 10-second steps
  }
  const settings = REGIMES[regime];

  const target = scaled(scaled(pair.baseVol, settings.vol, 1000), hourActivity(hourOfDay, open), 1000);
  const own = normal(seed, stream, step, 0);
  const common = normal(seed, 1, step, 0) * pair.usdSign;
  const mixed = Math.floor((917 * own + 400 * common) / 1000);
  const innovation = Math.floor((state.vol * mixed) / NORMAL_SD);

  let vol = Math.floor((900 * state.vol + 60 * target + 40 * Math.abs(innovation)) / 1000);
  vol = Math.min(pair.baseVol * 6, Math.max(Math.floor(pair.baseVol / 5), vol));

  const drift = scaled(state.vol, settings.drift, 1000);
  const reversion = settings.reversion ? scaled(state.anchor - state.mid, settings.reversion, 1000 * 2000) : 0;
  const home = midOf(pair);
  const pull = Math.floor((home - state.mid) / 400000); // a weak long-run pull, so a pair cannot wander without limit

  let jump = shockPips * pipOf(pair);
  if (open && draw(seed, stream, step, 40) % 40000 === 0) {
    const size = pair.shockPips + (draw(seed, stream, step, 41) % pair.shockPips);
    jump += (draw(seed, stream, step, 42) % 2 === 0 ? 1 : -1) * size * pipOf(pair);
  }
  if (jump !== 0) vol = Math.min(pair.baseVol * 6, vol * 3);

  const floor = Math.floor(home / 2);
  const mid = Math.max(floor, Math.min(home * 2, state.mid + drift + reversion + pull + innovation + jump));
  const anchor = state.anchor + Math.floor((mid - state.anchor) / 8640);
  return { mid, anchor, vol, regime, regimeLeft };
}

/** Bid and ask, as integers in the pair's price points, from a state. Ask is always above bid. */
function quotePoints(state, { instrument, hourOfDay, open }) {
  const pair = PAIRS[instrument];
  const point = pointOf(pair);
  const activity = hourActivity(hourOfDay, open);
  const stress = Math.floor((state.vol * 1000) / pair.baseVol); // 1000 at base volatility
  // Thin hours and high volatility both widen the spread.
  const session = 1000 + Math.max(0, 1000 - activity);
  const widened = Math.floor((pair.spreadPoints * session * Math.max(1000, stress)) / 1000000);
  const spread = Math.max(pair.minSpread, Math.min(pair.maxSpread, widened));
  const midPoints = Math.floor(state.mid / point);
  const bid = midPoints - Math.floor(spread / 2);
  return { bid, ask: bid + spread, spread };
}

module.exports = {
  CHECKPOINT_STEPS,
  MID_SCALE,
  MODEL_VERSION,
  NORMAL_SD,
  PAIRS,
  REGIMES,
  STEP_SECONDS,
  advance,
  draw,
  initialState,
  midOf,
  mix32,
  normal,
  pipOf,
  pointOf,
  quotePoints,
};
