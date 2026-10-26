# Lesson content migration

The one-off lesson migration is no longer available.

On 26 October 2026 the public route `POST /api/migrate-lessons` and the script `scripts/migrate-lesson-content.js` were removed. Both could rewrite every lesson document, and both contained a database connection string. Do not restore either one as a public endpoint or with a connection string in source.

The historical migration copied lesson summary text into the `content` field and wrapped plain-text descriptions in HTML. That work is not part of normal application startup. If it ever has to be repeated, it needs a separate operator-only process that reads `MONGO_URI` from the environment, is not exposed as an API route, and is reviewed before it runs. This repository does not include that process.

Deleting the source files does not revoke a database user that was previously committed. Rotate that user before treating any deployment as safe. Details are in the remediation addendum of `FOREX_ACADEMY_COMPREHENSIVE_AUDIT.md`.
