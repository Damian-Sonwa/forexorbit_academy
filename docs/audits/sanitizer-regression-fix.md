# H2: lesson and course HTML sanitizer regression

Branch `fix/phase-1-3-sanitizer-regression`, based on `c2e9715`. Not committed.

## What was wrong (reproduced with jsdom before the fix)

- **`c2e9715`:** `sanitizeHtml` cleaned the parsed document starting from `<html>`. `<head>` and `<body>` are not on the allowlist, so both were removed; `doc.body` then became `null`, the code threw, and the catch returned escaped HTML. Every lesson body and course description showed literal tags.
- **`origin/master` (`d7e0d1d` as last fetched; production may run this):** the old loop removed `<head>` and then skipped `<body>`, so nothing was sanitized. In jsdom, `<img onerror>` and `href="javascript:..."` passed through unchanged: stored XSS from instructor-authored HTML.

## Fix

`lib/html-sanitizer.ts` now uses DOMPurify 3 (`dompurify@^3.4.17`) in the browser:

- The fragment is sanitized as body content, never as a whole document.
- Explicit tag allowlist, unchanged except for `class` on text blocks for the editor's `ql-*` alignment classes.
- Per-tag attribute allowlist, enforced in a hook.
- Links and images accept only `http`, `https`, `mailto`, `tel` and relative URLs (`isValidUrl`). DOMPurify's default allowance for `data:` images is turned off.
- Links opening in a new tab get `rel="noopener noreferrer"`.

Server rendering (no DOM) still escapes the HTML, as before, so it is never trusted. Pages here load lesson HTML in the browser.

Compatibility checks: React 18.3, Next 15.5, `tsc` and the production build all pass. DOMPurify is imported on the server too, where it stays inactive.

## Tests

`tests/html-sanitizer-dom.test.js` (jsdom 26, dev dependency) exercises the full parse path:

- ordinary lesson content: headings, paragraphs, lists, images, links, tables
- scripts, event handlers, frames, SVG/MathML tricks, `<meta>`/`<base>`
- obfuscated `javascript:`, `data:` and `vbscript:` URLs
- malformed markup
- idempotence and per-call options

The fake-DOM tests that never included `<html>`, `<head>` or `<body>` were removed from `tests/browser-hardening.test.js`.

## Still to do

- Check one real lesson and one course description in a browser.
- When this is combined with the Phase 4 branch, `package.json` and `package-lock.json` need merging (this branch adds `dompurify` and `jsdom`).
