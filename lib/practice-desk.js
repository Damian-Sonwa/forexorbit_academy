'use strict';

/**
 * Rules for the practice desk's journal and instructor tasks (Phase 10, G8). Pure.
 *
 * Journal figures are the student's own notes. They are checked for shape only and are never
 * financial records: the simulator's ledger is the only source of truth for results.
 */

const MAX_NOTES_LENGTH = 5000;
const MAX_PRICE = 1000000;
const MAX_LOTS = 1000;
const MAX_REPORTED_PL = 1000000000;
const PAIR = /^[A-Z]{3}[/_]?[A-Z]{3}$/;

const positiveNumber = (value, max) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 && number <= max ? number : null;
};

/** A journal entry's fields, or { ok: false, error }. */
function readJournalEntry(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const bad = (error) => ({ ok: false, status: 400, error });
  const pair = typeof input.pair === 'string' ? input.pair.trim().toUpperCase() : '';
  if (!PAIR.test(pair)) return bad('Enter a currency pair such as EUR/USD.');
  if (input.direction !== 'buy' && input.direction !== 'sell') return bad('Invalid direction. Must be "buy" or "sell"');
  if (!['win', 'loss', 'breakeven', 'open'].includes(input.result)) return bad('Invalid result. Must be "win", "loss", "breakeven", or "open"');
  const entryPrice = positiveNumber(input.entryPrice, MAX_PRICE);
  const stopLoss = positiveNumber(input.stopLoss, MAX_PRICE);
  const takeProfit = positiveNumber(input.takeProfit, MAX_PRICE);
  const lotSize = positiveNumber(input.lotSize, MAX_LOTS);
  if (entryPrice === null || stopLoss === null || takeProfit === null || lotSize === null) return bad('Prices and lot size must be positive numbers.');
  let profitLoss;
  if (input.result !== 'open') {
    profitLoss = typeof input.profitLoss === 'string' && input.profitLoss.trim() !== '' ? Number(input.profitLoss) : input.profitLoss;
    if (typeof profitLoss !== 'number' || !Number.isFinite(profitLoss) || Math.abs(profitLoss) > MAX_REPORTED_PL) return bad('Profit/Loss is required for closed trades');
  }
  const notes = typeof input.notes === 'string' ? input.notes : '';
  if (notes.length > MAX_NOTES_LENGTH) return bad(`Notes can be at most ${MAX_NOTES_LENGTH} characters.`);
  const screenshot = typeof input.screenshot === 'string' && /^https:\/\//.test(input.screenshot) ? input.screenshot : null;
  return { ok: true, fields: { pair, direction: input.direction, entryPrice, stopLoss, takeProfit, lotSize, result: input.result, profitLoss, notes, screenshot } };
}

const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGE_SIZE = 200;

/** Bounds every list. Without ?page and ?limit a reader gets the newest 100. */
function listPage(query = {}) {
  const whole = (value) => (typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null);
  const limit = Math.min(LIST_MAX_PAGE_SIZE, whole(query.limit) || LIST_PAGE_SIZE);
  const page = whole(query.page) || 1;
  return { page, limit, skip: (page - 1) * limit };
}

/** Whether a task is this student's: assigned to them, or to everyone. */
const taskIsFor = (task, userId) => Boolean(task) && (task.assignedTo === null || task.assignedTo === undefined || task.assignedTo === userId);

/**
 * Completion is per student. A shared task holds one entry per student in `completions`. Rows from
 * before this change kept one flag for everyone, so that flag only counts for whoever set it, or for
 * the task's single assignee.
 */
function completionFor(task, userId) {
  const mine = task && task.completions && task.completions[userId];
  if (mine) return { completed: true, completedAt: mine };
  if (task && task.completed === true && (task.completedBy === userId || task.assignedTo === userId)) return { completed: true, completedAt: task.completedAt || null };
  return { completed: false, completedAt: null };
}

module.exports = { LIST_MAX_PAGE_SIZE, MAX_NOTES_LENGTH, completionFor, listPage, readJournalEntry, taskIsFor };
