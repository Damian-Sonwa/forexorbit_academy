'use strict';

/**
 * Student onboarding and profile details (POST /api/student/onboarding).
 *
 * Fields must have the types the onboarding and profile pages send; anything else is refused, so
 * no objects or oversized values are stored on the account. `tradingLevel` is the student's own
 * description of their experience. It sets the account's learningLevel only the first time
 * (placement); after that learningLevel changes only through course progress
 * (lib/learning-level.ts), so a student cannot move themselves into a higher level's community
 * rooms or notifications by editing their profile.
 */

const LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);
const TEXT_MAX = 200;
const TOPICS_MAX = 20;

const text = (value, { required = false } = {}) => {
  if (value == null || value === '') return required ? undefined : null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (required && !trimmed) return undefined;
  if (trimmed.length > TEXT_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed || null;
};

function refuse(error) {
  return { ok: false, status: 400, error };
}

/** Returns { ok: true, name, details, level } or { ok: false, status: 400, error }. */
function checkOnboardingInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  const required = ['fullName', 'dateOfBirth', 'contactNumber', 'educationLevel', 'tradingLevel', 'yearsOfExperience'];
  if (required.some((key) => input[key] == null || input[key] === '')) return refuse('Missing required fields');

  const topics = input.preferredTopics;
  if (!Array.isArray(topics) || topics.length === 0) return refuse('Please select at least one preferred learning topic');
  if (topics.length > TOPICS_MAX || topics.some((topic) => typeof topic !== 'string' || !topic.trim() || topic.length > TEXT_MAX)) {
    return refuse('Choose up to 20 topics from the list.');
  }
  if (!LEVELS.includes(input.tradingLevel)) return refuse('Choose a trading level: beginner, intermediate or advanced.');

  const years = typeof input.yearsOfExperience === 'number' ? String(input.yearsOfExperience) : input.yearsOfExperience;
  const fields = {
    fullName: text(input.fullName, { required: true }),
    dateOfBirth: text(input.dateOfBirth, { required: true }),
    gender: text(input.gender),
    contactNumber: text(input.contactNumber, { required: true }),
    educationLevel: text(input.educationLevel, { required: true }),
    certifications: text(input.certifications),
    yearsOfExperience: text(years, { required: true }),
  };
  const bad = Object.entries(fields).find(([, value]) => value === undefined);
  if (bad) return refuse(`Check the ${bad[0]} field: text of up to ${TEXT_MAX} characters.`);

  const prefs = input.notificationPreferences;
  let notificationPreferences = { email: true, sms: false, push: true };
  if (prefs != null) {
    if (typeof prefs !== 'object' || Array.isArray(prefs)) return refuse('Check the notification preferences.');
    notificationPreferences = {
      email: prefs.email !== false,
      sms: prefs.sms === true,
      push: prefs.push !== false,
    };
  }

  return {
    ok: true,
    name: fields.fullName,
    level: input.tradingLevel,
    details: {
      ...fields,
      tradingLevel: input.tradingLevel,
      preferredTopics: topics.map((topic) => topic.trim()),
      notificationPreferences,
    },
  };
}

module.exports = { LEVELS, checkOnboardingInput };
