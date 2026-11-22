'use strict';

/**
 * Curriculum edits in the course builder, as pure functions over the builder's module list:
 *   [{ id, title, implicit?, lessonIds: [] }]
 * Each returns a new list; the builder sends it to PUT /api/courses/:id/curriculum, which checks it
 * against the stored lessons (lib/course-content.js checkCurriculum).
 *
 * A course built before modules has one implicit module. The first structural change turns it into a
 * real module ("Module 1"), so nothing about such a course changes until its author restructures it.
 */

const { newId } = require('./course-content');

function clone(modules) {
  return modules.map((m) => ({ ...m, lessonIds: [...m.lessonIds] }));
}

/** Real modules (an implicit module becomes "Module 1"). */
function materialize(modules) {
  return clone(modules).map((m, i) => (m.implicit ? { id: newId(), title: m.title || `Module ${i + 1}`, lessonIds: m.lessonIds } : m));
}

function addModule(modules, title) {
  const next = materialize(modules);
  next.push({ id: newId(), title: title || `Module ${next.length + 1}`, lessonIds: [] });
  return next;
}

function renameModule(modules, moduleId, title) {
  return materialize(modules).map((m, i) => (m.id === moduleId || (modules[i] && modules[i].id === moduleId) ? { ...m, title } : m));
}

function moveModule(modules, moduleId, delta) {
  const next = materialize(modules);
  const from = modules.findIndex((m) => m.id === moduleId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.length) return null;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Moves a module to a position (drag and drop). */
function placeModule(modules, moduleId, toIndex) {
  const from = modules.findIndex((m) => m.id === moduleId);
  if (from < 0) return null;
  const next = materialize(modules);
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, next.length)), 0, item);
  return next;
}

/**
 * Deletes a module. Its lessons move to the module before it (or after it, for the first module).
 * The last module cannot be deleted.
 */
function deleteModule(modules, moduleId) {
  if (modules.length <= 1) return null;
  const index = modules.findIndex((m) => m.id === moduleId);
  if (index < 0) return null;
  const next = materialize(modules);
  const [removed] = next.splice(index, 1);
  const target = index > 0 ? next[index - 1] : next[0];
  if (index > 0) target.lessonIds.push(...removed.lessonIds);
  else target.lessonIds.unshift(...removed.lessonIds);
  return next;
}

function locate(modules, lessonId) {
  for (let m = 0; m < modules.length; m += 1) {
    const i = modules[m].lessonIds.indexOf(lessonId);
    if (i >= 0) return { m, i };
  }
  return null;
}

/** Moves a lesson to a module and position (drag and drop, "Move to module"). */
function placeLesson(modules, lessonId, toModuleId, toIndex) {
  const at = locate(modules, lessonId);
  const target = modules.findIndex((m) => m.id === toModuleId);
  if (!at || target < 0) return null;
  const next = materialize(modules);
  next[at.m].lessonIds.splice(at.i, 1);
  const list = next[target].lessonIds;
  let index = typeof toIndex === 'number' ? toIndex : list.length;
  if (at.m === target && typeof toIndex === 'number' && toIndex > at.i) index -= 1;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, lessonId);
  return next;
}

/**
 * Moves a lesson one step up or down (keyboard / buttons). At the edge of a module it moves into
 * the neighbouring module (end of the previous one, start of the next one).
 */
function stepLesson(modules, lessonId, delta) {
  const at = locate(modules, lessonId);
  if (!at) return null;
  const list = modules[at.m].lessonIds;
  if (delta < 0 && at.i > 0) return placeLesson(modules, lessonId, modules[at.m].id, at.i - 1);
  if (delta > 0 && at.i < list.length - 1) return placeLesson(modules, lessonId, modules[at.m].id, at.i + 2);
  if (delta < 0 && at.m > 0) return placeLesson(modules, lessonId, modules[at.m - 1].id);
  if (delta > 0 && at.m < modules.length - 1) return placeLesson(modules, lessonId, modules[at.m + 1].id, 0);
  return null;
}

/** The request body for PUT /api/courses/:id/curriculum. */
function curriculumPayload(modules) {
  return modules.map((m) => ({ id: m.id, title: m.title || '', lessonIds: [...m.lessonIds] }));
}

module.exports = { addModule, curriculumPayload, deleteModule, materialize, moveModule, placeLesson, placeModule, renameModule, stepLesson };
