# AI lesson development

- **Branch:** `feat/ai-lesson-development`, created from `7439b27` (origin/master, the deployed version).
- **Builds on:** the uncommitted course builder (`docs/audits/course-builder.md`), which it carries in the same worktree (`forexorbit_academy-course-builder`).
- **Status:** not committed, pushed or deployed.
- **Verdict:** CONDITIONALLY COMPLETE (see section 12).

## 1. Audit

- **Curriculum:**
  - courses hold modules (course builder);
  - each lesson is a topic with `courseId`, `moduleId`, `order` and its content as blocks, or legacy HTML for older lessons.
  - Topics, ordering and modules are read from the database at request time.
- **Manual authoring:** the course builder (blocks, uploads, quizzes, assignments, practical tasks). Nothing in it depends on AI.
- **Existing AI assistant (`lib/ai.ts`):**
  - **What it is:** the OpenAI SDK with a fixed OpenAI address and `gpt-3.5-turbo` by default, capped at 500 tokens. It's used by explain-lesson, answer-question, analyze-trade and task-hint.
  - **How "configured" is decided:** any `AI_API_KEY` starting with `sk-`. Production reports `{"configured":true}` (live read-only check), so such a key is set on Render.
  - **Why it fails:** every provider error is thrown as a generic error and answered with a generic 500. So a key with no paid credit (OpenAI returns 429 `insufficient_quota`), a revoked key (401) or a retired model (404) all look the same to users. The logs held only `OpenAI API error: ...`.
  - **Not confirmed live:** confirming the exact cause needs one real call with the production key. I didn't make it (it spends the account's credit and is a production action).
  - **Most likely cause:** an OpenAI key with no prepaid credit, since OpenAI has no free API tier.
  - **Fixed:** the assistant now uses the same provider settings as lesson development, and logs the classified reason (`aiAssistant`, code `auth` / `quota` / `rate_limited` / `model` / `unavailable`) without secrets.
- **Long-form support:** the old setup (500 tokens, no JSON mode) couldn't produce full lessons. The new adapter requests up to 6,000 output tokens with JSON output.

## 2. Provider (provider-independent)

`lib/ai-provider.js` is one OpenAI-compatible Chat Completions adapter. It selects a provider with `AI_LESSON_PROVIDER` and overrides the model with `AI_LESSON_MODEL`.

| Provider | Setting | Default model | Notes |
|---|---|---|---|
| **Groq (recommended)** | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Free tier with per-minute and per-day request and token limits (not unlimited; check the console). Long context, JSON mode, fast enough for full lessons. |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Free daily allowance ("neurons"), then paid. The free allowance is enough for occasional lesson drafts. JSON mode is not requested; the strict parser handles plain answers. |
| OpenAI | `AI_API_KEY` (existing) | `gpt-4o-mini` | Paid. Kept only because the key already exists; nothing switches to it automatically. |
| Ollama | `OLLAMA_BASE_URL` | `llama3.1` | Self-hosted. Needs a machine with a GPU; not deployable on Render free. |
| Other compatible server | `AI_LESSON_BASE_URL`, `AI_LESSON_API_KEY` | (set the model) | |

- **Pollinations.ai was not chosen:** no account-level quota, no service guarantee, and unclear commercial terms.
- **Free-tier terms change:** verify current limits before relying on them.
- **No fallback:** if the configured provider fails or runs out of quota, the request fails with a clear reason. There is never an automatic switch to another, possibly paid, provider.
- **Credentials:** keys stay on the server and never appear in responses or logs.

## 3. Generation architecture (dynamic, nothing hard-coded)

1. **Context:** `buildContext` reads the course, module, topic, earlier lessons (names and short excerpts for consistent terminology), upcoming lessons and the lesson's existing content. The data is the course's own records, read for owners only.
2. **Prompt:** an instructor persona with forex accuracy rules, safety rules, and the JSON schema. It contains no lesson text.
3. **Provider call:** one call with a 120-second timeout and at most one retry, and only for temporary errors.
4. **Validation:** `parseLesson` rejects a truncated answer, malformed JSON, missing content, or a whole lesson under 120 words. Nothing is saved in those cases.
5. **Conversion:** `toBlocks` produces the builder's own block format, so generated content is stored and rendered exactly like hand-written content:
   - headings, rich text, callouts, and worked examples (as example blocks);
   - links are stripped;
   - existing images, videos and files are kept where the model places them, and appended if it doesn't, so they are never dropped.
6. **Calculations** (`lib/forex-calculations.js`):
   - **Types:** pips, spread, lot units, pip value, position size, risk-to-reward, margin, profit/loss.
   - **How:** the model gives inputs; the application computes the result and writes every step. A wrong result from the model is reported and replaced by the correct one.
   - **Labelling:** every value is marked hypothetical, with conversion assumptions stated.
7. **Quality checklist** (deterministic): topic relevance, depth for the course level, structure, prose versus bullet points, preservation of existing material, repetition, duplicate headings, recomputed maths, numbers left in prose, unsupported statistics or citations, advice or guarantees, live-price claims, links, question validity, and an always-present "Reviewed by an instructor" item. The checklist never labels content as verified.

**Modes:**
- generate, improve, expand, rewrite and simplify (whole lesson);
- section (12 kinds, inserted after a chosen block);
- practical examples;
- knowledge checks: accepted questions go to the lesson quiz as a draft, and are never added to a published quiz.

## 4. Revisions and approval

- **Storage:** proposals (the last 10) and history (the last 10 replaced versions) live on the lesson document. There is no new collection. Lesson responses copy an explicit key list, so students never receive them.
- **Proposals:** a proposal never changes the lesson.
- **Accepting:**
  - requires the editor's current revision, so it never overwrites unsaved or newer edits;
  - refuses a proposal generated from an older version unless the instructor confirms;
  - keeps the replaced version in history, from which it can be restored;
  - on a live course, needs an explicit confirmation from an admin.
- **Rejecting:** leaves the lesson untouched.
- **Publishing:** never automatic. The existing review and publish workflow and its permissions apply.
- **Protected data:** student progress, attempts, submissions and grades refer to lesson ids and are unaffected.
- **Images:** media cleanup now counts images referenced in history and pending proposals, so a restorable version never loses its images.

## 5. Interface

- **Placement:** the "AI lesson assistant" panel sits in the lesson editor of the shared builder, so instructors and admins get the same panel.
- **Mode choice:** offered by what the lesson has (generate for empty topics; improve, expand, rewrite and simplify for written ones; section, examples and checks for both).
- **Options:** optional guidance (600 characters) and a choice of where inserted content goes.
- **States:** Ready, Generating (with elapsed time), Generated and saved as draft, Failed (with the reason), Accepted or Rejected.
- **Review tabs:**
  - Student preview, using the real renderer;
  - Compare (current and proposed side by side);
  - Quality checklist;
  - Questions.
- **Actions:** Accept, Reject, or Generate again. Draft proposals can be reopened, and earlier versions restored.
- **Without a provider:** the panel says AI is not set up and that manual editing works as normal.

## 6. Security and usage control

- **Access:**
  - Owners only: the assigned instructor, admins and the Super Admin. Other instructors get 404; students get 403.
  - The edit rule applies: instructors change drafts only; admins can change any course but must confirm for live ones.
- **Limits:**
  - per account: 12 generations per 10 minutes and a daily cap (`AI_LESSON_DAILY_LIMIT`, default 40), using the shared limiter store;
  - one generation at a time per lesson (a lock with a 3-minute timeout);
  - an identical repeated request reuses its draft without calling the provider.
- **Bounds:** input size and output tokens are capped.
- **Tracking:** token usage is recorded on each proposal and in `aiLessonGeneration` log events.

## 7. Database and storage

- **New lesson fields:** `aiProposals`, `history`, `aiGeneration`.
- **Unchanged:** no migration, no index, no new collection. Older code ignores these fields.

## 8. Testing

| Check | Result |
|---|---|
| Unit and route suite | 1,298 of 1,298, including 11 new AI tests |
| Real-MongoDB suites | 145 of 145 across 12 suites. The new AI suite covers generate, reuse, reject, accept (stale and current revision), draft quiz, manual edit afterwards, restore, improve keeping media, section insert, provider quota / auth / truncated / malformed / too short (nothing saved, lock released), the concurrency lock, another instructor, students, live-course confirmation, the published quiz left untouched, student read with no AI fields, progress intact, and no provider configured (manual editing still works). |
| Browser: AI workflow (`scripts/acceptance/ai-lesson-e2e.js`) | 34 of 34, all 20 required steps plus the admin checks |
| Browser: course builder regression | 40 of 40 |
| TypeScript, lint, production build | clean; 0 errors; passes |

**Provider used in tests:** every automated and browser test used a local test double that speaks the OpenAI-compatible API (`scripts/acceptance/fake-ai-provider.js`). It builds its answers from the prompt and is never loaded by the application. No real model was called: no key is available locally, and none was used in production.

## 9. Files

**New:**
- **Library:** `lib/ai-provider.js`, `lib/lesson-generation.js`, `lib/forex-calculations.js`, `lib/lesson-ai.js` (with type declarations).
- **API route:** `pages/api/lessons/[id]/ai.ts`.
- **Component:** `components/builder/AiAssistantPanel.tsx`.
- **Tests:** `tests/ai-lesson.test.js`, `tests/integration/ai-lesson-mongo.test.js`.
- **Acceptance:** `scripts/acceptance/ai-lesson-e2e.js`, `scripts/acceptance/fake-ai-provider.js`.

**Changed:**
- **AI assistant:** `lib/ai.ts` (provider settings and classified errors).
- **Limits and cleanup:** `lib/content-rate-limit.js` and `.d.ts`, `lib/media-cleanup.js`.
- **Builder:** `lib/course-curriculum.js` and `.d.ts` (pending count), `components/builder/LessonEditor.tsx`, `pages/builder/[courseId].tsx`.
- **Test wiring:** `package.json`, `.github/workflows/ci.yml`.

## 10. Owner setup (for production)

1. Create a free Groq API key.
2. On Render, set `GROQ_API_KEY`. Optionally set `AI_LESSON_DAILY_LIMIT`.
   - Groq is chosen automatically when that key exists.
   - The student-facing assistant also switches to Groq unless `AI_LESSON_PROVIDER` says otherwise.
   - To keep using OpenAI for the student assistant, add credit to that account instead.
3. Check the server logs: they show `aiProvider` and `aiAssistant` events with the classified reason if anything fails.

## 11. Assistant behaviour change

- **Default model:** with only `AI_API_KEY` set and no `AI_MODEL`, the student assistant now defaults to `gpt-4o-mini` instead of `gpt-3.5-turbo`. Setting `AI_MODEL` keeps any chosen model.
- **Retries:** the assistant's own 500-token limit and cache are unchanged. Its new lesson-style retry and quota handling apply to lesson development only.

## 12. Remaining limitations

1. **No real model run:** generation quality with a real model is unverified. The pipeline, validation, checks and interface are verified with a test double. A short trial with a real free key is recommended before instructors rely on it.
2. **Free-tier quotas:** limit how many lessons can be generated per day. Large lessons may need section-by-section generation on smaller models.
3. **What is and isn't checked:** worked calculations are computed exactly. Numbers written in prose are only flagged for review, and factual accuracy remains the instructor's responsibility, as the checklist states.
4. **Tables:** not produced; the block model has no table type, so content uses lists.
5. **No streaming:** generation is a single request (typically 10–60 seconds); the interface shows elapsed time.
6. **Curriculum suggestions:** shown to the instructor as notes only; they are never applied automatically, as required.
7. **Depends on the builder:** the whole feature depends on the uncommitted course builder in the same worktree.
