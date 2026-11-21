'use strict';

/**
 * Practical trading tasks: the task definition, its rubric and their validation. Pure.
 *
 * A practical task (schema 'practical_v2', stored in the existing `demoTasks` collection next to the
 * older free-form demo tasks) defines what the student must do on the simulator or show from an
 * external broker, and a versioned rubric of criteria. Each criterion is either:
 *   auto    checked by lib/practical-grading.js from the frozen simulator evidence, deterministically;
 *   manual  judged by the instructor (explanations, chart reading, external screenshots).
 * Profit is never a criterion by default: a task assesses process and decisions (direction, entry
 * type, stop and target placement, risk, sizing, management, explanation), not whether the
 * synthetic market happened to move the student's way. The 'net_result_positive' check exists only
 * for tasks whose stated objective is P&L interpretation, and must be added explicitly.
 *
 * Grading modes (persisted on the task and copied onto every submission):
 *   automatic  default; the engine's result is the grade, published at once. Every criterion must be
 *              auto-checkable: a task with manual criteria cannot use this mode (no silent switch).
 *   manual     the instructor scores every criterion; nothing is published until they do.
 *   assisted   the engine scores what it can, the instructor reviews, may adjust, and publishes.
 *              The instructor's publication is the final authority.
 */

const INSTRUMENT_IDS = Object.freeze(['EUR_USD', 'GBP_USD', 'AUD_USD', 'USD_JPY', 'USD_CAD', 'USD_CHF']);
const DIFFICULTIES = Object.freeze(['beginner', 'intermediate', 'advanced']);
const GRADING_MODES = Object.freeze(['automatic', 'manual', 'assisted']);
const DEFAULT_GRADING_MODE = 'automatic';
const TASK_STATUSES = Object.freeze(['draft', 'published', 'closed', 'archived']);
const EXTERNAL_POLICIES = Object.freeze(['none', 'optional', 'required']);
const COMPETENCIES = Object.freeze(['analysis', 'execution', 'risk', 'management', 'reflection']);
const SCHEMA = 'practical_v2';
const RUBRIC_MAX_CRITERIA = 12;
const TEXT_LIMITS = Object.freeze({ title: 140, summary: 400, instructions: 6000, objective: 240, criterionLabel: 120, criterionDescription: 400 });

const CATEGORIES = Object.freeze({
  trend_identification: { label: 'Market trend identification', competency: 'analysis' },
  support_resistance: { label: 'Support and resistance analysis', competency: 'analysis' },
  breakout: { label: 'Breakout identification', competency: 'analysis' },
  trend_continuation: { label: 'Trend continuation', competency: 'analysis' },
  reversal: { label: 'Reversal identification', competency: 'analysis' },
  risk_reward: { label: 'Risk-to-reward planning', competency: 'risk' },
  stop_target: { label: 'Stop-loss and take-profit placement', competency: 'risk' },
  position_sizing: { label: 'Position sizing', competency: 'risk' },
  market_entry: { label: 'Market entry execution', competency: 'execution' },
  pending_order: { label: 'Pending order placement', competency: 'execution' },
  trade_management: { label: 'Trade management', competency: 'management' },
  risk_management: { label: 'Risk management', competency: 'risk' },
  multi_trade: { label: 'Multiple-trade analysis', competency: 'management' },
  journal_evaluation: { label: 'Trading journal evaluation', competency: 'reflection' },
  pnl_interpretation: { label: 'Profit and loss interpretation', competency: 'reflection' },
  multi_timeframe: { label: 'Multi-timeframe analysis', competency: 'analysis' },
});

/**
 * Auto-checkable criteria (lib/practical-grading.js implements each `check`). `params` are taken
 * from the task requirements, so the rubric shows the exact rule.
 */
const AUTO_CHECKS = Object.freeze({
  trades_in_window: { label: 'Trades placed during the task', describe: (r) => `Every attached trade was opened after the task was published${r.dueAt ? ' and before the deadline' : ''}.` },
  trade_count: { label: 'Required number of trades', describe: (r) => (r.minTrades === r.maxTrades ? `Exactly ${r.minTrades} trade${r.minTrades === 1 ? '' : 's'}.` : `Between ${r.minTrades} and ${r.maxTrades} trades.`) },
  instrument_match: { label: 'Correct instrument', describe: (r) => `Trades on ${r.instruments.map((i) => i.replace('_', '/')).join(' or ')} only.` },
  direction_match: { label: 'Correct direction', describe: (r) => (r.side ? `Every trade is a ${r.side}.` : 'Any direction.') },
  order_type_match: { label: 'Correct order type', describe: (r) => `Entered with a ${r.orderTypes.join(' or ')} order.` },
  stop_loss_valid: { label: 'Stop-loss on the protective side', describe: () => 'Every trade has a stop-loss below the entry for a buy, above it for a sell.' },
  take_profit_set: { label: 'Take-profit defined', describe: () => 'Every trade has a take-profit on the profitable side of the entry.' },
  reward_risk_min: { label: 'Reward-to-risk ratio', describe: (r) => `Every trade plans at least ${r.minRewardRisk} : 1 (distance to target / distance to stop).` },
  risk_within_limit: { label: 'Risk per trade', describe: (r) => `Planned risk on every trade is at most ${r.maxRiskPercent}% of the account's starting balance.` },
  trade_closed: { label: 'Trade completed', describe: () => 'Every attached trade is closed by the time of submission.' },
  explanation_given: { label: 'Explanation provided', describe: (r) => `A written explanation of at least ${r.minExplanationChars} characters. (Its quality is judged by the instructor where the rubric says so.)` },
  net_result_positive: { label: 'Positive net result', describe: () => 'The attached trades closed with a positive net result. Used only when P&L is the stated objective.' },
});

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const bad = (field, error) => ({ ok: false, status: 400, field, error });

/** Plain text, trimmed, control characters removed; null when not a string or over `max`. */
function cleanText(value, max, { multiline = false } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let s = value.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim();
  return s.length > max ? null : s;
}

function decimalText(value, { min, max, places = 2 }) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n.toFixed(places).replace(/\.?0+$/, '') || '0';
}

function intIn(value, min, max) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Validates and normalises a task definition (from the generator or the manual editor).
 * Returns { ok, task } with only known fields, or a refusal { ok:false, field, error }.
 */
function readTaskDefinition(input, { now = new Date() } = {}) {
  const b = isObj(input) ? input : {};
  const title = cleanText(b.title, TEXT_LIMITS.title);
  if (!title) return bad('title', `A title of up to ${TEXT_LIMITS.title} characters is required.`);
  const summary = cleanText(b.summary, TEXT_LIMITS.summary);
  if (summary === null) return bad('summary', `The summary can be at most ${TEXT_LIMITS.summary} characters.`);
  const instructions = cleanText(b.instructions, TEXT_LIMITS.instructions, { multiline: true });
  if (!instructions) return bad('instructions', 'Instructions are required.');
  const objectives = Array.isArray(b.objectives) ? b.objectives.map((o) => cleanText(o, TEXT_LIMITS.objective)).filter((o) => o) : [];
  if (!objectives.length || objectives.length > 6) return bad('objectives', 'Give one to six learning objectives.');
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, b.category)) return bad('category', 'Choose a task category.');
  if (!DIFFICULTIES.includes(b.difficulty)) return bad('difficulty', 'Choose a difficulty.');
  const instruments = Array.isArray(b.instruments) ? [...new Set(b.instruments)].filter((i) => INSTRUMENT_IDS.includes(i)) : [];
  if (!instruments.length) return bad('instruments', 'Choose at least one instrument.');

  const r = isObj(b.requirements) ? b.requirements : {};
  const side = r.side === 'buy' || r.side === 'sell' ? r.side : null;
  const orderTypes = Array.isArray(r.orderTypes) ? [...new Set(r.orderTypes)].filter((t) => ['market', 'limit', 'stop'].includes(t)) : ['market', 'limit', 'stop'];
  if (!orderTypes.length) return bad('requirements.orderTypes', 'Allow at least one order type.');
  const minTrades = intIn(r.minTrades ?? 1, 0, 10);
  const maxTrades = intIn(r.maxTrades ?? Math.max(1, minTrades || 1), 0, 10);
  if (minTrades === null || maxTrades === null || maxTrades < minTrades) return bad('requirements.minTrades', 'Trades must be 0-10, with the minimum at most the maximum.');
  const maxRiskPercent = decimalText(r.maxRiskPercent ?? '2', { min: 0.1, max: 2 });
  if (maxRiskPercent === null) return bad('requirements.maxRiskPercent', 'Maximum risk per trade must be 0.1% to 2% (the simulator never allows more than 2%).');
  const minRewardRisk = decimalText(r.minRewardRisk ?? '1', { min: 0.5, max: 10 });
  if (minRewardRisk === null) return bad('requirements.minRewardRisk', 'Minimum reward-to-risk must be 0.5 to 10.');
  const minExplanationChars = intIn(r.minExplanationChars ?? 150, 0, 3000);
  if (minExplanationChars === null) return bad('requirements.minExplanationChars', 'The explanation length must be 0-3000 characters.');
  const external = EXTERNAL_POLICIES.includes(r.external) ? r.external : 'none';
  const maxAttachments = intIn(r.maxAttachments ?? (external === 'none' ? 2 : 4), 0, 6);
  if (maxAttachments === null) return bad('requirements.maxAttachments', 'Attachments must be 0-6.');
  if (external === 'required' && maxAttachments < 1) return bad('requirements.maxAttachments', 'External evidence is required, so at least one attachment must be allowed.');
  const requireTakeProfit = r.requireTakeProfit !== false;
  const requireClosed = r.requireClosed === true;
  const simulator = r.simulator !== false && maxTrades > 0;

  const gradingMode = b.gradingMode === undefined || b.gradingMode === null || b.gradingMode === '' ? DEFAULT_GRADING_MODE : b.gradingMode;
  if (!GRADING_MODES.includes(gradingMode)) return bad('gradingMode', 'Grading must be automatic, manual or system-assisted.');

  const maxAttempts = intIn(b.maxAttempts ?? 2, 1, 5);
  if (maxAttempts === null) return bad('maxAttempts', 'Attempts must be 1-5.');
  let dueAt = null;
  if (b.dueAt) {
    const d = new Date(b.dueAt);
    if (Number.isNaN(d.getTime())) return bad('dueAt', 'The deadline is not a valid date.');
    if (d.getTime() < now.getTime() + 15 * 60 * 1000) return bad('dueAt', 'The deadline must be at least 15 minutes from now.');
    dueAt = d;
  }
  const requirements = { side, orderTypes, minTrades, maxTrades, maxRiskPercent, minRewardRisk, minExplanationChars, external, maxAttachments, requireTakeProfit, requireClosed, simulator, instruments, dueAt };

  const rubric = readRubric(b.rubric, requirements);
  if (!rubric.ok) return rubric;
  if (gradingMode === 'automatic' && rubric.rubric.criteria.some((c) => c.kind === 'manual')) {
    return bad('gradingMode', 'This rubric has criteria only an instructor can judge. Choose manual or system-assisted grading, or remove those criteria.');
  }
  if (gradingMode === 'automatic' && external === 'required') {
    return bad('gradingMode', 'External screenshots cannot be verified automatically. Choose manual or system-assisted grading for a task that requires them.');
  }
  if (!simulator && rubric.rubric.criteria.some((c) => c.kind === 'auto' && !['explanation_given'].includes(c.check))) {
    return bad('rubric', 'Simulator criteria need at least one simulator trade in the requirements.');
  }

  return {
    ok: true,
    task: {
      schema: SCHEMA,
      title,
      summary,
      instructions,
      objectives,
      category: b.category,
      competency: CATEGORIES[b.category].competency,
      difficulty: b.difficulty,
      instruments,
      requirements,
      rubric: rubric.rubric,
      gradingMode,
      maxAttempts,
      dueAt,
    },
  };
}

/** Rubric: 1-12 criteria; auto criteria name a known check; points 1-100 each; max score = sum. */
function readRubric(input, requirements) {
  const list = Array.isArray(input) ? input : isObj(input) && Array.isArray(input.criteria) ? input.criteria : [];
  if (!list.length || list.length > RUBRIC_MAX_CRITERIA) return bad('rubric', `A rubric needs 1 to ${RUBRIC_MAX_CRITERIA} criteria.`);
  const seen = new Set();
  const criteria = [];
  for (const [index, raw] of list.entries()) {
    const c = isObj(raw) ? raw : {};
    const points = intIn(c.points, 1, 100);
    if (points === null) return bad(`rubric.${index}.points`, 'Each criterion is worth 1-100 points.');
    if (c.kind === 'auto') {
      if (!Object.prototype.hasOwnProperty.call(AUTO_CHECKS, c.check)) return bad(`rubric.${index}.check`, 'Unknown automatic check.');
      if (seen.has(c.check)) return bad(`rubric.${index}.check`, 'Each automatic check can appear once.');
      if (c.check === 'direction_match' && !requirements.side) return bad(`rubric.${index}.check`, 'A direction check needs a required direction.');
      seen.add(c.check);
      criteria.push({ id: c.check, kind: 'auto', check: c.check, label: AUTO_CHECKS[c.check].label, description: AUTO_CHECKS[c.check].describe(requirements), points });
    } else if (c.kind === 'manual') {
      const label = cleanText(c.label, TEXT_LIMITS.criterionLabel);
      if (!label) return bad(`rubric.${index}.label`, 'Each instructor-judged criterion needs a name.');
      const description = cleanText(c.description, TEXT_LIMITS.criterionDescription);
      if (description === null) return bad(`rubric.${index}.description`, 'The description is too long.');
      const id = `m${criteria.filter((x) => x.kind === 'manual').length + 1}`;
      criteria.push({ id, kind: 'manual', check: null, label, description, points });
    } else {
      return bad(`rubric.${index}.kind`, 'A criterion is automatic or instructor-judged.');
    }
  }
  return { ok: true, rubric: { version: 1, criteria, maxScore: criteria.reduce((s, c) => s + c.points, 0) } };
}

/** What a student may see of a task: no internal notes, generator settings or answer guidance. */
function presentTaskForStudent(task) {
  return {
    id: String(task._id),
    title: task.title,
    summary: task.summary || '',
    instructions: task.instructions,
    objectives: task.objectives || [],
    category: task.category,
    categoryLabel: (CATEGORIES[task.category] || {}).label || task.category,
    competency: task.competency,
    difficulty: task.difficulty,
    instruments: task.instruments || [],
    requirements: { ...task.requirements, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null },
    rubric: { version: task.rubric.version, maxScore: task.rubric.maxScore, criteria: task.rubric.criteria.map((c) => ({ id: c.id, kind: c.kind, label: c.label, description: c.description, points: c.points })) },
    gradingMode: task.gradingMode,
    maxAttempts: task.maxAttempts,
    dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
    publishedAt: task.publishedAt ? new Date(task.publishedAt).toISOString() : null,
    status: task.status,
    courseId: task.courseId || null,
  };
}

/**
 * Safe light formatting for instructions: paragraphs, "- " bullets and **bold**, as a list of
 * blocks rendered by React as text (never as HTML).
 */
function formatBlocks(text) {
  const blocks = [];
  for (const para of String(text || '').split(/\n{2,}/)) {
    const lines = para.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) blocks.push({ type: 'list', items: lines.map((l) => l.replace(/^\s*[-*]\s+/, '')) });
    else blocks.push({ type: 'p', text: lines.join('\n') });
  }
  return blocks;
}

module.exports = {
  AUTO_CHECKS,
  CATEGORIES,
  COMPETENCIES,
  DEFAULT_GRADING_MODE,
  DIFFICULTIES,
  EXTERNAL_POLICIES,
  GRADING_MODES,
  INSTRUMENT_IDS,
  SCHEMA,
  TASK_STATUSES,
  TEXT_LIMITS,
  cleanText,
  formatBlocks,
  presentTaskForStudent,
  readRubric,
  readTaskDefinition,
};
