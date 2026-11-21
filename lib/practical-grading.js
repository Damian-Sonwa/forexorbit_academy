'use strict';

/**
 * Practical task grading engine. Pure and deterministic: the same frozen rubric and evidence always
 * give the same result (no clock, no randomness, no floats in money or price arithmetic).
 *
 * Input:
 *   rubric        the rubric snapshot frozen on the submission (criteria with points).
 *   requirements  the requirements snapshot frozen on the submission.
 *   evidence      { trades, startingBalance, windowStart, windowEnd, explanationLength,
 *                   attachments }, frozen at submission from the server's own position and order
 *                   records (lib/practical-tasks.js). Nothing here is typed by the student except
 *                   the explanation, which is only measured.
 *
 * Each automatic criterion is scored from the trades: points x (trades that pass / trades checked),
 * rounded down to a whole point, so partly-correct work earns partial credit and the arithmetic is
 * exact. Instructor-judged criteria are left as 'needs_instructor' with no score. Profit is not
 * rewarded unless the rubric explicitly contains 'net_result_positive'.
 *
 * Output: criteria with score, status and a plain explanation, the score over the automatic part,
 * whether the result is complete, observations, recommendations and a fingerprint of the inputs.
 */

const crypto = require('crypto');
const { parseMoney, parsePrice } = require('./trading/money');

const ENGINE = 'practical-grading';
const VERSION = '1.0.0';

const big = (text, parse) => {
  try {
    return text === null || text === undefined || text === '' ? null : parse(String(text));
  } catch {
    return null;
  }
};
const abs = (v) => (v < 0n ? -v : v);
const hundredths = (text) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(text));
  return m ? BigInt(m[1]) * 100n + BigInt((m[2] || '0').padEnd(2, '0')) : null;
};
const pairOf = (id) => String(id || '').replace('_', '/');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Per-trade checks: true (pass), false (fail). Prices and money in exact integer units. */
const TRADE_CHECKS = {
  trades_in_window: (t, ctx) => {
    const opened = new Date(t.openedAt).getTime();
    return opened >= ctx.start && opened <= ctx.end;
  },
  instrument_match: (t, ctx) => ctx.req.instruments.includes(t.instrument),
  direction_match: (t, ctx) => !ctx.req.side || t.side === ctx.req.side,
  order_type_match: (t, ctx) => ctx.req.orderTypes.includes(t.orderType),
  stop_loss_valid: (t) => {
    const entry = big(t.entry, parsePrice);
    const stop = big(t.stopLoss, parsePrice);
    if (entry === null || stop === null) return false;
    return t.side === 'buy' ? stop < entry : stop > entry;
  },
  take_profit_set: (t) => {
    const entry = big(t.entry, parsePrice);
    const target = big(t.takeProfit, parsePrice);
    if (entry === null || target === null) return false;
    return t.side === 'buy' ? target > entry : target < entry;
  },
  reward_risk_min: (t, ctx) => {
    const entry = big(t.entry, parsePrice);
    const stop = big(t.stopLoss, parsePrice);
    const target = big(t.takeProfit, parsePrice);
    const ratio = hundredths(ctx.req.minRewardRisk);
    if (entry === null || stop === null || target === null || ratio === null) return false;
    const risk = abs(entry - stop);
    if (risk === 0n) return false;
    if (!TRADE_CHECKS.take_profit_set(t) || !TRADE_CHECKS.stop_loss_valid(t)) return false;
    return abs(target - entry) * 100n >= ratio * risk;
  },
  risk_within_limit: (t, ctx) => {
    const risk = big(t.plannedRisk, parseMoney);
    const percent = hundredths(ctx.req.maxRiskPercent);
    // Each trade against its own account's starting balance (an account reset starts a new one).
    const balance = big(t.startingBalance, parseMoney) ?? ctx.startingBalance;
    if (risk === null || percent === null || balance === null) return false;
    // risk <= balance x percent / 100, with percent in hundredths: risk x 10000 <= balance x p.
    return risk * 10000n <= balance * percent;
  },
  trade_closed: (t) => t.status === 'closed',
};

const DETAIL = {
  trades_in_window: 'opened during the task',
  instrument_match: 'on a required instrument',
  direction_match: 'in the required direction',
  order_type_match: 'entered with an allowed order type',
  stop_loss_valid: 'with a stop-loss on the protective side',
  take_profit_set: 'with a take-profit on the profitable side',
  reward_risk_min: 'meeting the reward-to-risk minimum',
  risk_within_limit: 'inside the risk limit',
  trade_closed: 'closed',
};

const RECOMMEND = {
  trades_in_window: 'Place the trades for a task after you start it and before the deadline; earlier trades cannot be used as evidence.',
  trade_count: 'Check how many trades the task asks for before submitting.',
  instrument_match: 'Trade only the instrument the task names; the desk opens on it when you start from the task.',
  direction_match: 'The task fixed the direction. Read the brief again before placing the order.',
  order_type_match: 'Use the order type the task asks for: a limit order to enter at a better price, a stop order to enter on a break.',
  stop_loss_valid: 'Place the stop-loss where your idea is proven wrong: below the entry for a buy, above it for a sell.',
  take_profit_set: 'Set a take-profit on every trade so the plan has a defined target.',
  reward_risk_min: 'Move the target further or the entry closer to the stop so the planned reward is at least the required multiple of the risk; if the chart does not allow it, skip the trade.',
  risk_within_limit: 'Reduce the position size until the order preview shows planned risk within the limit. Size from the stop distance, not a fixed lot.',
  trade_closed: 'Let each trade reach its stop or target, or close it, before submitting.',
  explanation_given: 'Write a fuller explanation: what you saw on the chart, why you entered, and why the stop and target are where they are.',
  net_result_positive: 'Review why the trades lost: was the idea wrong, or was the execution or timing off?',
};

/** Grades one submission. Never throws on malformed evidence: it scores what can be established. */
function gradePractical({ rubric, requirements, evidence }) {
  const req = { instruments: [], orderTypes: ['market', 'limit', 'stop'], ...requirements };
  const trades = Array.isArray(evidence && evidence.trades) ? evidence.trades : [];
  const ctx = {
    req,
    start: evidence && evidence.windowStart ? new Date(evidence.windowStart).getTime() : 0,
    end: evidence && evidence.windowEnd ? new Date(evidence.windowEnd).getTime() : Number.MAX_SAFE_INTEGER,
    startingBalance: big(evidence && evidence.startingBalance, parseMoney),
  };
  const explanationLength = Number.isInteger(evidence && evidence.explanationLength) ? evidence.explanationLength : 0;
  const noTradesAllowed = req.minTrades === 0;

  const criteria = rubric.criteria.map((c) => {
    const base = { id: c.id, kind: c.kind, label: c.label, description: c.description, points: c.points };
    if (c.kind !== 'auto') return { ...base, score: null, status: 'needs_instructor', detail: 'Judged by the instructor.', evidence: [] };
    if (c.check === 'explanation_given') {
      const ok = explanationLength >= (req.minExplanationChars || 0);
      return { ...base, score: ok ? c.points : 0, status: ok ? 'met' : 'not_met', detail: ok ? `Explanation of ${explanationLength} characters (at least ${req.minExplanationChars} required). Length only; its quality is not machine-judged.` : `Explanation of ${explanationLength} characters; at least ${req.minExplanationChars} required.`, evidence: [] };
    }
    if (c.check === 'trade_count') {
      const ok = trades.length >= req.minTrades && trades.length <= req.maxTrades;
      return { ...base, score: ok ? c.points : 0, status: ok ? 'met' : 'not_met', detail: `${plural(trades.length, 'trade')} attached; the task asks for ${req.minTrades === req.maxTrades ? req.minTrades : `${req.minTrades}-${req.maxTrades}`}.`, evidence: trades.map((t) => t.positionId) };
    }
    if (c.check === 'net_result_positive') {
      const closed = trades.filter((t) => t.status === 'closed');
      if (!closed.length) return { ...base, score: 0, status: 'not_met', detail: 'No closed trades attached.', evidence: [] };
      let total = 0n;
      for (const t of closed) total += big(t.realizedPl, parseMoney) || 0n;
      const ok = total > 0n;
      return { ...base, score: ok ? c.points : 0, status: ok ? 'met' : 'not_met', detail: ok ? 'The closed trades have a positive net result.' : 'The closed trades do not have a positive net result.', evidence: closed.map((t) => t.positionId) };
    }
    const check = TRADE_CHECKS[c.check];
    if (!check) return { ...base, score: 0, status: 'not_met', detail: 'This check is not available.', evidence: [] };
    if (!trades.length) {
      if (noTradesAllowed) return { ...base, score: c.points, status: 'not_applicable', detail: 'No trade was required and none was attached.', evidence: [] };
      return { ...base, score: 0, status: 'not_met', detail: 'No simulator trades were attached.', evidence: [] };
    }
    const passed = trades.filter((t) => check(t, ctx));
    const score = Number((BigInt(c.points) * BigInt(passed.length)) / BigInt(trades.length));
    const status = passed.length === trades.length ? 'met' : passed.length ? 'partial' : 'not_met';
    return { ...base, score, status, detail: `${passed.length} of ${plural(trades.length, 'trade')} ${DETAIL[c.check]}.`, evidence: trades.map((t) => ({ positionId: t.positionId, passed: passed.includes(t) })) };
  });

  const auto = criteria.filter((c) => c.kind === 'auto');
  const autoScore = auto.reduce((s, c) => s + c.score, 0);
  const autoMax = auto.reduce((s, c) => s + c.points, 0);
  const complete = criteria.every((c) => c.kind === 'auto');
  const maxScore = rubric.maxScore;
  const recommendations = auto.filter((c) => c.status === 'not_met' || c.status === 'partial').map((c) => RECOMMEND[c.id] || null).filter(Boolean);
  const strengths = auto.filter((c) => c.status === 'met').map((c) => c.label);

  const risks = trades.map((t) => big(t.plannedRisk, parseMoney)).filter((v) => v !== null);
  const observations = { risk: [], execution: [] };
  if (risks.length && ctx.startingBalance) {
    const largest = risks.reduce((m, v) => (v > m ? v : m), 0n);
    const basis = largest * 10000n / ctx.startingBalance; // hundredths of a percent
    observations.risk.push(`Largest planned risk: ${(basis / 100n).toString()}.${(basis % 100n).toString().padStart(2, '0')}% of the starting balance (limit ${req.maxRiskPercent}%).`);
  }
  const withoutTarget = trades.filter((t) => !t.takeProfit).length;
  if (withoutTarget) observations.risk.push(`${plural(withoutTarget, 'trade')} had no take-profit.`);
  if (trades.length) {
    const types = {};
    for (const t of trades) types[t.orderType] = (types[t.orderType] || 0) + 1;
    observations.execution.push(`Orders: ${Object.entries(types).map(([k, n]) => `${n} ${k}`).join(', ')}. Instruments: ${[...new Set(trades.map((t) => pairOf(t.instrument)))].join(', ')}.`);
    const open = trades.filter((t) => t.status !== 'closed').length;
    if (open) observations.execution.push(`${plural(open, 'trade')} still open at submission.`);
  }

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ v: VERSION, rubric: rubric.criteria.map((c) => [c.id, c.kind, c.check, c.points]), req, evidence: { ...evidence, trades } })).digest('hex').slice(0, 32);
  return {
    engine: ENGINE,
    version: VERSION,
    criteria,
    autoScore,
    autoMax,
    score: complete ? autoScore : null,
    maxScore,
    percent: complete ? percentText(autoScore, maxScore) : null,
    complete,
    strengths,
    recommendations,
    observations,
    fingerprint,
  };
}

/** score / max as a percentage with one decimal, rounded half up, as text. */
function percentText(score, max) {
  if (!max) return '0.0';
  const tenths = (BigInt(score) * 2000n + BigInt(max)) / (BigInt(max) * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

module.exports = { ENGINE, VERSION, gradePractical, percentText };
