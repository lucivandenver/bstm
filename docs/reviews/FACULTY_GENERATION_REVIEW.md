# Faculty drafting and public content review

Prepared: 2026-11-02 UTC. Branch: `fix/faculty-generation-public-content`.
Base: `d31451d8f7264f519bc28bcbb5fc2d0f5370acee` (`origin/main` at start).
Working directory: `/workspace/scratch/30b73cec05a0/bstm`.

## Problem and behavior

The screenshot shows a generic failure after submitting `/faculty/sources/2/generate`. That message does not identify the production cause. The previous flow could hide configuration/provider errors behind the generic 500 handler, had unhandled job-admission and draft-save failures, and marked a job complete before saving its course and revision.

The new flow validates the provider's structured output and source quotes, assigns stable internal module/question references, and saves the course, revision, job result and audit record in one transaction. It preserves faculty ownership and unpublished/review-before-publish gates. Failed saves roll back the draft; a logging failure cannot mask the original error. Configuration, provider limits, response truncation, unsupported source content and database problems have safe codes and log references without exposing keys, SQL or source content.

The source form retains fields and extracted text on errors, disables duplicate submissions while waiting and offers a source-preserving manual import without Gemini or an AI quota. Manual drafts need faculty-authored assessments before publishing. Admission is serialized per faculty; stale running jobs expire after five minutes. There is no application-level rolling daily course-generation cap; provider quotas still apply. Source uploads retain their short-window rate limit.

## Competency areas

Tourism knowledge is one of the four supported areas, alongside Communication, Workplace and Digital skills. It used to be the first/default option. New source drafts and new manual courses now require an explicit choice. Existing course values are preserved.

## Public design

- The original three campus carousel images and the main landing narrative remain.
- Six system-feature cards use repository-owned SVG icons and accurate feature descriptions. Disconnected footer labels and arrows were removed.
- Aggregate statistics come from active account, published course, completion and active career-pathway records. Zero remains zero; no invented readiness scores or matches.
- The hero's illustrative percentage/job-match cards were permanently replaced with the learning journey. If the landing design is restored later, **do not restore the 78% / 94% / sample job-match panel**.
- Header/dropdown styling includes an open-state indicator, keyboard/outside-click dismissal and scroll shadow. Mobile keeps three institution logos, CareerBridge branding and auth actions inside the menu.
- About uses the supplied student cutout as an unchanged asset. Its text, FAQ and campus background remain, with unsupported fixed numerical claims corrected.
- Portal navigation scrolls independently so the Faculty ID/footer stays reachable on short screens.

The generated concept image is a visual preview only. The application uses responsive templates, CSS and SVGs, not a screenshot as its interface.

## Deployment and diagnosis

This change adds no schema fields and does not require a new migration on an already migrated deployment. If `COURSE_SCHEMA_NOT_READY` appears, verify the existing additive migration ran against the same database as the running service. Never use force-sync/reset on production data.

AI needs private Render environment values `GEMINI_API_KEY` and `GEMINI_MODEL` for a model available to that project. Existing Google OAuth credentials are separate from Gemini credentials. Model names with a leading `models/` are normalized. Keep secrets in Render's environment settings, never commit them.

| Code | Action |
| --- | --- |
| `COURSE_AI_NOT_CONFIGURED` | Configure the two Gemini values, or use manual import. |
| `COURSE_AI_AUTH` / `COURSE_AI_MODEL` | Check the configured key, project permissions and model. |
| `COURSE_AI_QUOTA` | Wait for the provider quota/rate window or use a manual draft. Legacy `COURSE_DAILY_LIMIT` jobs can be resumed; the application cap has been removed. |
| `COURSE_AI_TRUNCATED` / `COURSE_SOURCE_INSUFFICIENT` | Use fewer questions or a more focused source. |
| `COURSE_SOURCE_UNSUPPORTED` | Review source text; the ungrounded draft was rejected. |
| `COURSE_SCHEMA_NOT_READY` | Check the existing migration on the configured database. |
| `COURSE_STORAGE_BUSY` / `COURSE_STORAGE_UNAVAILABLE` | Check the matching reference in Render logs and database availability. |

Production Aiven connectivity, Render logs and a real Gemini request were not available in this workspace. The exact live root cause remains unverified until the branch is deployed and tested with the service's environment. Local database tests use isolated SQLite, with simulated MySQL error codes; they do not replace a production MySQL smoke test.

## Validation

`npm test`: **38 passed, 0 failed**. This includes PDF/DOCX/PPTX extraction, Faculty → Student → rubric grading → award, ownership/section scopes, revisioning, assignments, retakes, migrations preserving legacy records, and Google registration/login safeguards.

New regression coverage includes provider 401/403/404/429/5xx, timeout, incomplete/blocked/non-JSON replies, source quote rejection, missing tables/fields, quota-admission failures, transactional save rollback, failure-log faults and duplicate jobs. HTTP coverage checks preserved source-form inputs, JSON draft generation, blocking publication before review, publication after review, and manual import with Gemini disabled.

Headless Chromium QA passed at **320, 390, 768 and 1440 px**: public layout has no horizontal overflow, three carousel slides remain, mobile logos/auth and dropdown behavior work, registration dialogs fit the viewport, About photo loads, 12 Faculty screens render, manual source import opens the editor, and mobile Faculty navigation remains accessible. No browser script errors were observed.

## Review locally

Open the repository in VS Code and use Source Control to inspect the branch's changes. Terminal commands can be run in VS Code's integrated terminal:

```sh
git status --short --branch
git diff origin/main --stat
git diff origin/main
npm test
```

Main source entry points: `controllers/facultyController.js`, `services/courseAi.js`, `services/courseGenerationErrors.js`, `views/faculty/source.xian`, `public/js/faculty-generation.js`, `views/home.xian`, `views/about.xian`, the public component partials and `public/css/public-content.css`.

Changes are prepared locally. Push, pull-request creation and deployment remain pending the user's approval to push. No main merge, reset, file deletion or production database mutation was performed.
