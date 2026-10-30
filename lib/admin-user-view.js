'use strict';

/**
 * What staff see in the user list (GET /api/admin/users): only the fields the admin pages use.
 * Date of birth, contact and phone numbers, onboarding answers, Cloudinary ids, password hashes
 * and session counters are never read for this list, whatever the caller's role.
 */

const ADMIN_USER_LIST_PROJECTION = Object.freeze({
  name: 1,
  email: 1,
  role: 1,
  status: 1,
  isExpert: 1,
  createdAt: 1,
});

function toAdminUserRow(doc) {
  const id = String(doc._id);
  return {
    _id: id,
    id,
    name: typeof doc.name === 'string' ? doc.name : '',
    email: typeof doc.email === 'string' ? doc.email : '',
    role: typeof doc.role === 'string' ? doc.role : '',
    status: typeof doc.status === 'string' && doc.status ? doc.status : 'approved',
    isExpert: doc.isExpert === true,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  };
}

module.exports = { ADMIN_USER_LIST_PROJECTION, toAdminUserRow };
