'use strict';

/**
 * Practical task generator: deterministic templates, no AI service. Pure.
 *
 * generateTask(params, context) returns a complete, editable task definition (the same shape the
 * manual editor produces) built from a category template and the instructor's settings. The same
 * params and seed give the same task; `seed` picks between the template's phrasings so "generate
 * again" offers a variant. `context` may carry a simulated quote taken when the task was generated;
 * it is quoted as simulated, never as a live price.
 *
 * Every template asks for decisions that can be assessed (direction, entry type, stop and target
 * placement, risk, sizing, explanation), never "make a profit". The rubric mixes automatic checks
 * (lib/practical-grading.js) with instructor-judged criteria for what a machine cannot judge
 * (quality of reasoning, chart reading). readTaskDefinition validates the result like any other task.
 */

const { CATEGORIES, DIFFICULTIES, GRADING_MODES, INSTRUMENT_IDS, DEFAULT_GRADING_MODE, readTaskDefinition } = require('./practical-task-spec');

const label = (id) => id.replace('_', '/');
const LEVEL = {
  beginner: { risk: '1', rr: '1.5', explain: 120, attempts: 3 },
  intermediate: { risk: '1', rr: '2', explain: 200, attempts: 2 },
  advanced: { risk: '0.5', rr: '2.5', explain: 300, attempts: 2 },
};

/** Small deterministic hash for picking phrasings. */
function pick(list, seed, salt) {
  let h = 2166136261;
  for (const ch of `${seed}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return list[h % list.length];
}

const manual = (label, description, points) => ({ kind: 'manual', label, description, points });
const auto = (check, points) => ({ kind: 'auto', check, points });

/**
 * Each template: title, objectives, instruction steps and rubric for the given settings `s`
 * ({ pair, side, level, risk, rr, explain, orderTypes, trades }).
 */
const TEMPLATES = {
  trend_identification: (s) => ({
    title: [`Identify the ${s.pair} trend and trade with it`, `${s.pair} trend reading and execution`],
    objectives: ['Identify the prevailing trend from market structure (higher highs and lows, or lower highs and lows).', 'Enter in the direction of the trend with a defined stop-loss and take-profit.', `Keep risk at or below ${s.risk}% of the account.`],
    steps: [`Open the ${s.pair} chart on the simulated trading desk and study at least the last 50 candles of the M15 timeframe.`, 'Write down whether the market is trending up, trending down or ranging, and name the swing highs and lows that show it.', `If a trend is present, place ${s.tradesText} in the trend's direction. If the market is ranging, explain why and place no trade.`, `Place the stop-loss beyond the most recent swing point and the take-profit at least ${s.rr} times the stop distance.`, 'Explain the structure you saw and why your stop and target sit where they do.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('stop_loss_valid', 15), auto('take_profit_set', 10), auto('reward_risk_min', 15), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Trend correctly identified', 'The written analysis names the trend and the swing points that define it.', 25)],
  }),
  support_resistance: (s) => ({
    title: [`Trade a ${s.pair} support or resistance level`, `${s.pair}: levels, reaction and risk`],
    objectives: ['Mark a support or resistance level that the market has respected at least twice.', 'Plan an entry at the level with a pending order.', 'Place the stop beyond the level and size the trade to the risk limit.'],
    steps: [`On the ${s.pair} chart, find a horizontal level the price has reacted to at least twice.`, 'Decide whether you expect a bounce from the level and in which direction.', `Place ${s.tradesText} using a limit order at the level.`, `Put the stop-loss on the other side of the level and the take-profit at least ${s.rr} times the stop distance.`, 'Explain the touches that confirm the level and what would invalidate your idea.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('order_type_match', 15), auto('stop_loss_valid', 15), auto('reward_risk_min', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Level correctly identified', 'The level is supported by visible touches, and invalidation is stated.', 25)],
    orderTypes: ['limit'],
  }),
  breakout: (s) => ({
    title: [`Plan a ${s.pair} breakout entry`, `${s.pair} range breakout`],
    objectives: ['Identify a consolidation range and its boundaries.', 'Enter on a break of the range with a stop order.', 'Protect the trade with a stop inside the range.'],
    steps: [`Find a recent ${s.pair} consolidation and note its high and low.`, `Place ${s.tradesText} as a stop order just beyond the boundary you expect to break.`, `Put the stop-loss back inside the range and the take-profit at least ${s.rr} times the stop distance.`, 'Explain why you expect the break in that direction and how you would recognise a false breakout.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('order_type_match', 15), auto('stop_loss_valid', 15), auto('reward_risk_min', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Range and breakout logic', 'The range boundaries are correct and the false-breakout plan is sensible.', 25)],
    orderTypes: ['stop'],
  }),
  trend_continuation: (s) => ({
    title: [`Join the ${s.pair} trend on a pullback`, `${s.pair} pullback continuation`],
    objectives: ['Recognise a pullback within an established trend.', 'Enter in the trend direction after the pullback.', 'Place the stop beyond the pullback extreme.'],
    steps: [`Confirm the ${s.pair} trend on the chart.`, 'Wait for a pullback against the trend and mark where it ends.', `Place ${s.tradesText} in the trend's direction${s.side ? ` (${s.side})` : ''}.`, `Put the stop-loss beyond the pullback's extreme and the take-profit at least ${s.rr} times the stop distance.`, 'Explain how you judged the pullback had finished.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), ...(s.side ? [auto('direction_match', 10)] : []), auto('stop_loss_valid', 15), auto('reward_risk_min', 15), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Pullback analysis', 'The trend, the pullback and its end are identified clearly.', s.side ? 25 : 35)],
  }),
  reversal: (s) => ({
    title: [`Assess a possible ${s.pair} reversal`, `${s.pair} reversal: evidence before entry`],
    objectives: ['Identify evidence that a trend may be ending (failed high or low, structure break).', 'Trade the reversal only with confirmation and tight risk.', 'Explain the evidence and the risk of being wrong.'],
    steps: [`Study the ${s.pair} chart for a trend that is losing momentum.`, 'List at least two pieces of evidence that the trend may reverse.', `If the evidence is strong, place ${s.tradesText} against the old trend with a stop beyond the last extreme.`, `Keep risk at or below ${s.risk}% and target at least ${s.rr} times the stop distance.`, 'Explain the evidence and why this is not simply a pullback.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('stop_loss_valid', 15), auto('reward_risk_min', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Reversal evidence', 'At least two valid pieces of evidence are given.', 25), manual('Reversal versus pullback', 'The student distinguishes a reversal from a pullback.', 15)],
  }),
  risk_reward: (s) => ({
    title: [`Plan a ${s.pair} trade with at least ${s.rr} : 1 reward-to-risk`, `${s.pair} reward-to-risk planning`],
    objectives: [`Plan a trade whose target is at least ${s.rr} times its stop distance.`, 'Choose the stop and target from the chart, not from a fixed number of pips.', 'Calculate and state the reward-to-risk ratio.'],
    steps: [`Choose an entry on ${s.pair} from the chart.`, 'Place the stop-loss where your trade idea is proven wrong.', `Place the take-profit at a level the market can reach that gives at least ${s.rr} : 1.`, `Place ${s.tradesText} with these levels.`, 'State the stop distance, the target distance and the ratio in your explanation.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 5), auto('stop_loss_valid', 15), auto('take_profit_set', 15), auto('reward_risk_min', 30), auto('risk_within_limit', 10), auto('explanation_given', 5), manual('Levels chosen from the chart', 'Stop and target are justified by chart levels, and the ratio is stated correctly.', 15)],
  }),
  stop_target: (s) => ({
    title: [`Place a protective stop and a realistic target on ${s.pair}`, `${s.pair} stop-loss and take-profit placement`],
    objectives: ['Place the stop-loss where the trade idea is invalidated.', 'Place the take-profit at a reachable level.', 'Avoid stops so tight that normal movement closes the trade.'],
    steps: [`Choose a ${s.pair} entry.`, 'Place the stop-loss beyond a recent swing point or level.', 'Place the take-profit before the next significant opposing level.', `Place ${s.tradesText} with both levels set.`, 'Explain what each level is based on.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 5), auto('stop_loss_valid', 25), auto('take_profit_set', 20), auto('reward_risk_min', 10), auto('risk_within_limit', 10), auto('explanation_given', 5), manual('Level reasoning', 'Each level is tied to a visible chart feature.', 20)],
  }),
  position_sizing: (s) => ({
    title: [`Size a ${s.pair} position to ${s.risk}% risk`, `${s.pair} position sizing`],
    objectives: [`Calculate a position size that risks no more than ${s.risk}% of the account.`, 'Use the stop distance to size the trade, not a fixed lot size.', 'Show the calculation.'],
    steps: [`Choose a ${s.pair} entry and stop-loss from the chart.`, 'Measure the stop distance in pips.', `Calculate the units so that hitting the stop loses at most ${s.risk}% of the account's starting balance. The order ticket's preview shows the planned risk.`, `Place ${s.tradesText} with that size.`, 'Show your calculation in the explanation.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 5), auto('stop_loss_valid', 15), auto('risk_within_limit', 40), auto('take_profit_set', 10), auto('explanation_given', 5), manual('Sizing calculation', 'The calculation is shown and matches the order placed.', 20)],
  }),
  market_entry: (s) => ({
    title: [`Execute a planned ${s.pair} market entry`, `${s.pair} market execution`],
    objectives: ['Execute a market order that matches a written plan.', 'Set the stop-loss and take-profit at entry.', 'Record why the entry was taken now.'],
    steps: [`Write a short plan for ${s.pair}: direction, reason, stop, target.`, `Execute ${s.tradesText} at market${s.side ? ` as a ${s.side}` : ''} with the stop-loss and take-profit set on the ticket.`, 'Use the ticket note to record the reason for the trade.', 'Explain whether the execution matched the plan.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), ...(s.side ? [auto('direction_match', 10)] : []), auto('order_type_match', 15), auto('stop_loss_valid', 15), auto('take_profit_set', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Plan and execution agree', 'The written plan and the trade placed match.', s.side ? 15 : 25)],
    orderTypes: ['market'],
  }),
  pending_order: (s) => ({
    title: [`Place a ${s.pair} pending order at a planned level`, `${s.pair} pending order placement`],
    objectives: ['Choose between a limit and a stop order correctly for the idea.', 'Place the order at a planned price with a stop and target.', 'Explain the choice of order type.'],
    steps: [`Decide on a ${s.pair} price where you want to enter.`, 'Use a limit order to enter at a better price, or a stop order to enter on momentum.', `Place ${s.tradesText} as a pending order with a stop-loss and take-profit.`, 'Explain why you chose that order type and level.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('order_type_match', 20), auto('stop_loss_valid', 15), auto('take_profit_set', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Order type reasoning', 'The order type matches the idea and the reason is correct.', 20)],
    orderTypes: ['limit', 'stop'],
  }),
  trade_management: (s) => ({
    title: [`Manage a ${s.pair} trade to completion`, `${s.pair} trade management`],
    objectives: ['Manage an open trade according to a plan.', 'Close the trade by stop, target or a planned manual exit.', 'Explain each management decision.'],
    steps: [`Open ${s.tradesText} on ${s.pair} with a stop-loss and take-profit.`, 'Decide in advance under what conditions you would move the stop or exit early.', 'Manage the trade until it is closed.', 'Explain each decision and whether it followed your plan.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 5), auto('stop_loss_valid', 15), auto('risk_within_limit', 15), auto('trade_closed', 20), auto('explanation_given', 5), manual('Management plan followed', 'Decisions follow the stated plan; changes are justified.', 35)],
    requireClosed: true,
  }),
  risk_management: (s) => ({
    title: [`Trade ${s.pair} inside strict risk limits`, `${s.pair} risk management`],
    objectives: [`Keep every trade at or below ${s.risk}% risk.`, 'Always protect the trade with a stop-loss.', `Plan at least ${s.rr} : 1 reward-to-risk.`],
    steps: [`Place ${s.tradesText} on ${s.pair}.`, `Each trade must risk at most ${s.risk}% of the account and have a stop-loss and take-profit.`, 'Explain how you decided each trade was worth its risk.'],
    rubric: [auto('trades_in_window', 5), auto('trade_count', 10), auto('instrument_match', 5), auto('stop_loss_valid', 20), auto('risk_within_limit', 30), auto('reward_risk_min', 15), auto('explanation_given', 5), manual('Risk reasoning', 'The student explains why each trade justified its risk.', 10)],
  }),
  multi_trade: (s) => ({
    title: [`Plan and compare ${s.trades} trades on ${s.pairs}`, 'Multiple-trade analysis'],
    objectives: ['Plan several independent trades with consistent risk.', 'Compare their setups and outcomes.', 'Identify what to repeat and what to change.'],
    steps: [`Place ${s.tradesText} on ${s.pairs}, each with a stop-loss and take-profit.`, `Keep each trade at or below ${s.risk}% risk.`, 'Close every trade before submitting.', 'Compare the trades: which setups were strongest, which decisions you would change.'],
    rubric: [auto('trades_in_window', 5), auto('trade_count', 15), auto('instrument_match', 5), auto('stop_loss_valid', 10), auto('risk_within_limit', 15), auto('trade_closed', 10), auto('explanation_given', 5), manual('Comparison and lessons', 'A real comparison of the setups with concrete lessons.', 35)],
    requireClosed: true,
    multi: true,
  }),
  journal_evaluation: (s) => ({
    title: ['Evaluate your recent trades and set an improvement goal', 'Trading journal evaluation'],
    objectives: ['Review your own closed trades honestly.', 'Identify a recurring strength and a recurring mistake.', 'Set one measurable improvement goal.'],
    steps: [`Close ${s.tradesText} on the simulator during this task and write a trade review for each.`, 'Look for patterns across the trades: entries, stops, emotions, plan discipline.', 'Name one strength, one mistake and one measurable goal for the next trades.'],
    rubric: [auto('trades_in_window', 10), auto('trade_count', 10), auto('trade_closed', 10), auto('explanation_given', 10), manual('Honest evaluation', 'Strengths and mistakes are specific and supported by the trades.', 35), manual('Measurable goal', 'The goal is specific and measurable.', 25)],
    requireClosed: true,
  }),
  pnl_interpretation: (s) => ({
    title: [`Interpret the result of your ${s.pair} trades`, 'Profit and loss interpretation'],
    objectives: ['Explain a trade result in pips, money and as a percentage of the account.', 'Separate the quality of the decision from the outcome.', 'Relate the result to the planned risk.'],
    steps: [`Place and close ${s.tradesText} on ${s.pair} with a stop-loss.`, 'For each trade, state the result in pips, in account currency and as a percentage of the balance.', 'Compare the result with the planned risk (R multiple).', 'Explain whether the decision was good regardless of the outcome.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 5), auto('stop_loss_valid', 10), auto('trade_closed', 20), auto('explanation_given', 10), manual('Result calculated correctly', 'Pips, money, percentage and R multiple are correct.', 30), manual('Decision versus outcome', 'The decision is judged on its quality, not only its result.', 20)],
    requireClosed: true,
  }),
  multi_timeframe: (s) => ({
    title: [`Align ${s.pair} timeframes before entering`, `${s.pair} multi-timeframe analysis`],
    objectives: ['Read the higher-timeframe trend (H1) before the entry timeframe (M5 or M15).', 'Enter only in the direction of the higher timeframe.', 'Place stop and target from the entry timeframe structure.'],
    steps: [`On the ${s.pair} chart, read the H1 trend first and note it.`, 'Switch to M15 or M5 and wait for an entry in the H1 direction.', `Place ${s.tradesText} with a stop-loss and take-profit.`, 'Explain what each timeframe showed and how they agreed.'],
    rubric: [auto('trades_in_window', 5), auto('instrument_match', 10), auto('stop_loss_valid', 15), auto('reward_risk_min', 10), auto('risk_within_limit', 15), auto('explanation_given', 5), manual('Timeframe alignment', 'The H1 and entry-timeframe reads are stated and agree with the trade.', 40)],
  }),
};

/**
 * Builds a task from generator settings. Returns { ok, task, settings } or a refusal. The result is
 * validated by readTaskDefinition, so a generated task obeys every rule a manual one does.
 */
function generateTask(params = {}, { now = new Date(), context = null } = {}) {
  const category = params.category;
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, category)) return { ok: false, status: 400, field: 'category', error: 'Choose a task category.' };
  const difficulty = DIFFICULTIES.includes(params.difficulty) ? params.difficulty : 'beginner';
  const instruments = Array.isArray(params.instruments) && params.instruments.length ? [...new Set(params.instruments)].filter((i) => INSTRUMENT_IDS.includes(i)) : ['EUR_USD'];
  if (!instruments.length) return { ok: false, status: 400, field: 'instruments', error: 'Choose a supported instrument.' };
  const level = LEVEL[difficulty];
  const side = params.side === 'buy' || params.side === 'sell' ? params.side : null;
  const seed = typeof params.seed === 'string' || Number.isInteger(params.seed) ? String(params.seed).slice(0, 40) : '0';
  const risk = typeof params.maxRiskPercent === 'string' || typeof params.maxRiskPercent === 'number' ? String(params.maxRiskPercent) : level.risk;
  const rr = typeof params.minRewardRisk === 'string' || typeof params.minRewardRisk === 'number' ? String(params.minRewardRisk) : level.rr;
  const isMulti = category === 'multi_trade' || category === 'journal_evaluation';
  const trades = Number.isInteger(params.trades) && params.trades >= 1 && params.trades <= 10 ? params.trades : isMulti ? 3 : 1;
  const tradesText = trades === 1 ? 'one trade' : `${trades} trades`;
  const pair = label(instruments[0]);
  const pairs = instruments.map(label).join(' or ');
  const s = { pair, pairs, side, risk, rr, trades, tradesText, level: difficulty };
  const t = TEMPLATES[category](s);

  const gradingMode = GRADING_MODES.includes(params.gradingMode) ? params.gradingMode : DEFAULT_GRADING_MODE;
  const external = ['none', 'optional', 'required'].includes(params.external) ? params.external : 'none';
  let rubric = t.rubric;
  if (external !== 'none') rubric = [...rubric, manual('External evidence', 'Screenshots from the external platform show the trade described. Treated as student-submitted evidence, not verified records.', 10)];
  // Automatic grading needs every criterion to be checkable: instructor-judged criteria are
  // dropped and their points moved to the explanation check, which the student is told is a
  // length check only. The instructor sees this in the preview and can choose another mode.
  let notice = null;
  if (gradingMode === 'automatic') {
    if (external === 'required') return { ok: false, status: 400, field: 'gradingMode', error: 'External screenshots cannot be verified automatically. Choose manual or system-assisted grading for a task that requires them.' };
    const manualPoints = rubric.filter((c) => c.kind === 'manual').reduce((sum, c) => sum + c.points, 0);
    if (manualPoints) {
      rubric = rubric.filter((c) => c.kind === 'auto').map((c) => (c.check === 'explanation_given' ? { ...c, points: c.points + manualPoints } : c));
      if (!rubric.some((c) => c.check === 'explanation_given')) rubric.push(auto('explanation_given', manualPoints));
      notice = 'Automatic grading cannot judge the quality of reasoning, so the instructor-judged criteria were left out. Choose system-assisted grading to keep them.';
    }
  }
  const contextLine = context && context.price
    ? `Market context: when this task was generated, the simulated ${pair} price was about ${context.price} (simulated, not a live price).`
    : `Market context: use the simulated ${pair} market on the trading desk. Prices there are simulated, not live.`;
  const externalLine = external === 'required'
    ? 'Also attach screenshots of the same kind of trade from an external demo platform (for example OANDA), showing the instrument, direction, entry, stop-loss and take-profit. Do not share login details.'
    : external === 'optional'
      ? 'You may also attach screenshots from an external demo platform (for example OANDA). They are reviewed as supporting evidence. Do not share login details.'
      : '';
  const instructions = [
    contextLine,
    t.steps.map((step) => `- ${step}`).join('\n'),
    `Risk rules: at most ${risk}% of the account per trade${rr ? `, and at least ${rr} : 1 planned reward-to-risk` : ''}. A trade's outcome does not decide the grade: the quality of your decisions does.`,
    externalLine,
  ].filter(Boolean).join('\n\n');

  const definition = {
    title: pick(t.title, seed, 'title'),
    summary: `${CATEGORIES[category].label} on ${pairs}. ${difficulty[0].toUpperCase()}${difficulty.slice(1)} level.`,
    instructions,
    objectives: t.objectives,
    category,
    difficulty,
    instruments: isMulti ? instruments : [instruments[0]],
    requirements: {
      side,
      orderTypes: Array.isArray(params.orderTypes) && params.orderTypes.length ? params.orderTypes : t.orderTypes || ['market', 'limit', 'stop'],
      minTrades: trades,
      maxTrades: isMulti ? trades + 2 : trades,
      maxRiskPercent: risk,
      minRewardRisk: rr,
      minExplanationChars: level.explain,
      external,
      requireTakeProfit: true,
      requireClosed: Boolean(t.requireClosed),
      simulator: true,
    },
    rubric,
    gradingMode,
    maxAttempts: Number.isInteger(params.maxAttempts) ? params.maxAttempts : level.attempts,
    dueAt: params.dueAt || null,
  };
  const checked = readTaskDefinition(definition, { now });
  if (!checked.ok) return checked;
  return { ok: true, draft: definition, task: checked.task, notice, generator: { category, difficulty, instruments, side, seed, gradingMode, external } };
}

module.exports = { TEMPLATE_IDS: Object.freeze(Object.keys(TEMPLATES)), generateTask };
