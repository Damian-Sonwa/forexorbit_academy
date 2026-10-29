'use strict';

/**
 * Filters for the public course list (GET /api/courses). Query values are used only as plain
 * strings: repeated parameters are ignored, the search text is matched literally (regex
 * characters escaped) and capped, so a request cannot run an arbitrary pattern on the database.
 */

const SEARCH_MAX_CHARS = 100;
const FILTER_MAX_CHARS = 50;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plainParam(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function buildCourseListQuery(params) {
  const source = params && typeof params === 'object' ? params : {};
  const query = {};
  const category = plainParam(source.category, FILTER_MAX_CHARS);
  const difficulty = plainParam(source.difficulty, FILTER_MAX_CHARS);
  const search = plainParam(source.search, SEARCH_MAX_CHARS);
  if (category) query.category = category;
  if (difficulty) query.difficulty = difficulty;
  if (search) {
    const pattern = escapeRegex(search);
    query.$or = [
      { title: { $regex: pattern, $options: 'i' } },
      { description: { $regex: pattern, $options: 'i' } },
    ];
  }
  return query;
}

module.exports = { SEARCH_MAX_CHARS, buildCourseListQuery, escapeRegex };
