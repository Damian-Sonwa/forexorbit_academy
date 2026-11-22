'use strict';

/**
 * Worked forex calculations for generated lessons, computed here rather than trusted from the
 * model. The model describes a calculation (its type, inputs and the result it expects); this
 * module recomputes it, writes the steps, and reports whether the model's result matched.
 * Students therefore always see arithmetic that is consistent with its inputs.
 *
 * Conventions (stated in every worked example):
 *   - prices are quote currency per 1 unit of base currency;
 *   - a pip is the pip size given (0.0001 for most pairs, 0.01 for JPY pairs);
 *   - conversionRate turns quote-currency amounts into the account currency
 *     (1 when the account currency is the quote currency);
 *   - every value is hypothetical; nothing here is a live price.
 */

const TYPES = Object.freeze(['pips', 'spread', 'pip_value', 'lot_units', 'position_size', 'risk_reward', 'margin', 'profit_loss']);
const PIP_SIZES = Object.freeze([0.0001, 0.01, 0.00001, 0.001, 0.1, 1]);

function num(value) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(n, decimals) {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function decimalsOf(x) {
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

function priceDecimals(pipSize) {
  return pipSize >= 0.01 ? 3 : 5;
}

function need(inputs, names) {
  const out = {};
  for (const name of names) {
    const v = num(inputs[name]);
    if (v === null) return { error: `Missing or invalid input "${name}".` };
    out[name] = v;
  }
  return out;
}

function checkPip(pipSize) {
  return PIP_SIZES.some((p) => Math.abs(p - pipSize) < 1e-12) ? null : `Pip size ${pipSize} is unusual; most pairs use 0.0001 and JPY pairs 0.01.`;
}

/** Computes one calculation. Returns { ok, result, unit, decimals, steps, warnings } or { ok: false, error }. */
function compute(type, rawInputs = {}) {
  const inputs = rawInputs && typeof rawInputs === 'object' ? rawInputs : {};
  const warnings = [];
  const conv = num(inputs.conversionRate) ?? 1;
  const ccy = typeof inputs.accountCurrency === 'string' && /^[A-Z]{3}$/.test(inputs.accountCurrency) ? inputs.accountCurrency : 'account currency';
  const quote = typeof inputs.quoteCurrency === 'string' && /^[A-Z]{3}$/.test(inputs.quoteCurrency) ? inputs.quoteCurrency : 'quote currency';
  if (conv <= 0) return { ok: false, error: 'conversionRate must be positive.' };
  const convStep = (amount, d = 2) => (conv === 1 ? [] : [`Convert to ${ccy}: ${fmt(amount, d)} ${quote} × ${conv} = ${fmt(amount * conv, d)} ${ccy}`]);
  switch (type) {
    case 'pips': {
      const v = need(inputs, ['priceFrom', 'priceTo', 'pipSize']);
      if (v.error) return { ok: false, error: v.error };
      const w = checkPip(v.pipSize); if (w) warnings.push(w);
      const d = priceDecimals(v.pipSize);
      const diff = Math.abs(v.priceTo - v.priceFrom);
      const pips = diff / v.pipSize;
      return { ok: true, result: round(pips, 1), unit: 'pips', decimals: 1, warnings, steps: [
        `Price difference: |${fmt(v.priceTo, d)} − ${fmt(v.priceFrom, d)}| = ${fmt(diff, d)}`,
        `Pips: ${fmt(diff, d)} ÷ ${v.pipSize} = ${fmt(pips, 1)} pips`,
      ] };
    }
    case 'spread': {
      const v = need(inputs, ['bid', 'ask', 'pipSize']);
      if (v.error) return { ok: false, error: v.error };
      if (v.ask < v.bid) return { ok: false, error: 'The ask price must not be below the bid price.' };
      const d = priceDecimals(v.pipSize);
      const pips = (v.ask - v.bid) / v.pipSize;
      return { ok: true, result: round(pips, 1), unit: 'pips', decimals: 1, warnings, steps: [
        `Spread = ask − bid = ${fmt(v.ask, d)} − ${fmt(v.bid, d)} = ${fmt(v.ask - v.bid, d)}`,
        `In pips: ${fmt(v.ask - v.bid, d)} ÷ ${v.pipSize} = ${fmt(pips, 1)} pips`,
      ] };
    }
    case 'lot_units': {
      const v = need(inputs, ['lots']);
      if (v.error) return { ok: false, error: v.error };
      const per = num(inputs.unitsPerLot) ?? 100000;
      return { ok: true, result: round(v.lots * per, 0), unit: 'units', decimals: 0, warnings, steps: [`${v.lots} lot × ${fmt(per, 0)} units per standard lot = ${fmt(v.lots * per, 0)} units`] };
    }
    case 'pip_value': {
      const v = need(inputs, ['units', 'pipSize']);
      if (v.error) return { ok: false, error: v.error };
      const w = checkPip(v.pipSize); if (w) warnings.push(w);
      const inQuote = v.units * v.pipSize;
      return { ok: true, result: round(inQuote * conv, 2), unit: conv === 1 ? quote : ccy, decimals: 2, warnings, steps: [
        `Pip value = units × pip size = ${fmt(v.units, 0)} × ${v.pipSize} = ${fmt(inQuote, 2)} ${quote} per pip`,
        ...convStep(inQuote),
      ] };
    }
    case 'position_size': {
      const v = need(inputs, ['accountBalance', 'riskPercent', 'stopPips', 'pipValuePerLot']);
      if (v.error) return { ok: false, error: v.error };
      if (v.stopPips <= 0 || v.pipValuePerLot <= 0) return { ok: false, error: 'Stop distance and pip value must be positive.' };
      if (v.riskPercent > 5) warnings.push(`Risking ${v.riskPercent}% per trade is far above the 1-2% usually taught.`);
      const risk = v.accountBalance * (v.riskPercent / 100);
      const lots = risk / (v.stopPips * v.pipValuePerLot);
      return { ok: true, result: round(lots, 2), unit: 'lots', decimals: 2, warnings, steps: [
        `Amount at risk = ${fmt(v.accountBalance, 2)} × ${v.riskPercent}% = ${fmt(risk, 2)} ${ccy}`,
        `Risk per lot = ${v.stopPips} pips × ${fmt(v.pipValuePerLot, 2)} ${ccy} per pip = ${fmt(v.stopPips * v.pipValuePerLot, 2)} ${ccy}`,
        `Position size = ${fmt(risk, 2)} ÷ ${fmt(v.stopPips * v.pipValuePerLot, 2)} = ${fmt(lots, 2)} lots`,
      ] };
    }
    case 'risk_reward': {
      const v = need(inputs, ['entry', 'stop', 'target']);
      if (v.error) return { ok: false, error: v.error };
      const buy = v.target > v.entry;
      if ((buy && v.stop >= v.entry) || (!buy && v.stop <= v.entry)) return { ok: false, error: 'The stop-loss must be on the opposite side of the entry from the target.' };
      const d = Math.max(decimalsOf(v.entry), decimalsOf(v.stop), decimalsOf(v.target));
      const risk = Math.abs(v.entry - v.stop);
      const reward = Math.abs(v.target - v.entry);
      const ratio = reward / risk;
      return { ok: true, result: round(ratio, 2), unit: ': 1 reward-to-risk', decimals: 2, warnings, steps: [
        `${buy ? 'Buy' : 'Sell'} at ${fmt(v.entry, d)}; stop-loss ${fmt(v.stop, d)}; take-profit ${fmt(v.target, d)}`,
        `Risk = |${fmt(v.entry, d)} − ${fmt(v.stop, d)}| = ${fmt(risk, d)}`,
        `Reward = |${fmt(v.target, d)} − ${fmt(v.entry, d)}| = ${fmt(reward, d)}`,
        `Reward-to-risk = ${fmt(reward, d)} ÷ ${fmt(risk, d)} = ${fmt(ratio, 2)} : 1`,
      ] };
    }
    case 'margin': {
      const v = need(inputs, ['units', 'price', 'leverage']);
      if (v.error) return { ok: false, error: v.error };
      if (v.leverage <= 0) return { ok: false, error: 'Leverage must be positive.' };
      const notional = v.units * v.price;
      const margin = notional / v.leverage;
      return { ok: true, result: round(margin * conv, 2), unit: conv === 1 ? quote : ccy, decimals: 2, warnings, steps: [
        `Position value = ${fmt(v.units, 0)} units × ${v.price} = ${fmt(notional, 2)} ${quote}`,
        `Required margin = ${fmt(notional, 2)} ÷ ${v.leverage} (leverage ${v.leverage}:1) = ${fmt(margin, 2)} ${quote}`,
        ...convStep(margin),
      ] };
    }
    case 'profit_loss': {
      const v = need(inputs, ['units', 'entry', 'exit']);
      if (v.error) return { ok: false, error: v.error };
      const side = inputs.side === 'sell' ? 'sell' : 'buy';
      const move = (v.exit - v.entry) * (side === 'buy' ? 1 : -1);
      const pl = move * v.units;
      const d = Math.max(decimalsOf(v.entry), decimalsOf(v.exit));
      return { ok: true, result: round(pl * conv, 2), unit: conv === 1 ? quote : ccy, decimals: 2, warnings, steps: [
        `${side === 'buy' ? 'Buy' : 'Sell'} ${fmt(v.units, 0)} units at ${fmt(v.entry, d)}, close at ${fmt(v.exit, d)}`,
        `Price move in your favour = ${side === 'buy' ? `${fmt(v.exit, d)} − ${fmt(v.entry, d)}` : `${fmt(v.entry, d)} − ${fmt(v.exit, d)}`} = ${fmt(move, d)}`,
        `Profit/loss = ${fmt(move, d)} × ${fmt(v.units, 0)} = ${fmt(pl, 2)} ${quote}`,
        ...convStep(pl),
      ] };
    }
    default:
      return { ok: false, error: `Unknown calculation type "${type}".` };
  }
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * Checks a calculation the model described: { type, label, inputs, expectedResult }.
 * Returns { ok, verified, label, result, unit, steps, warnings, claimed, matches } or { ok: false, error }.
 */
function verifyCalculation(calc) {
  if (!calc || typeof calc !== 'object') return { ok: false, error: 'A calculation is not valid.' };
  const computed = compute(calc.type, calc.inputs);
  if (!computed.ok) return { ok: false, error: computed.error, label: typeof calc.label === 'string' ? calc.label : '' };
  const claimed = num(calc.expectedResult);
  const tolerance = Math.max(Math.abs(computed.result) * 0.005, 0.5 * 10 ** -computed.decimals);
  const matches = claimed === null ? null : Math.abs(claimed - computed.result) <= tolerance;
  return {
    ok: true,
    label: typeof calc.label === 'string' ? calc.label.slice(0, 120) : '',
    type: calc.type,
    result: computed.result,
    unit: computed.unit,
    decimals: computed.decimals,
    steps: computed.steps,
    warnings: computed.warnings,
    claimed,
    matches,
  };
}

/** The worked example as plain text for an "example" block (labelled hypothetical). */
function formatWorked(v) {
  const resultLine = `Result: ${fmt(v.result, v.decimals)} ${v.unit}`.replace(' : 1', ' : 1');
  return [...v.steps, resultLine, '', 'Hypothetical values for illustration only, not live prices.'].join('\n');
}

module.exports = { PIP_SIZES, TYPES, compute, formatWorked, verifyCalculation };
