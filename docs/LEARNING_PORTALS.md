# Learning portals and interface release

Branch: `feature/complete-learning-portals`. Built on main `39f5ab691103b8ce482c10dd18594e2e88626881`.

## Feature coverage

| Area | Implemented behavior |
| --- | --- |
| Student profile | Personal/academic/OJT/career preferences, target roles, relocation, work preferences, self-declared skills, photo and private qualification files. Official ID/section corrections require Admin review. |
| Catalog | Search, competency filtering, course preview, outcomes, owner, duration, prerequisites, publication/enrollment gates, required section assignments and due dates. |
| Learning | Version-frozen attempts, collapsible outline, persisted lesson checks, optional course pre-test, module quizzes, final assessment, practical tasks, feedback, progress and retakes. |
| Saved answers | Course and diagnostic drafts persist server-side. An optimistic revision prevents a stale tab silently overwriting another tab. The UI reports saved/pending/conflict states. Final submission validates all answers again. |
| Assessments | Server grading, published passing score, configurable time/submission limits, random question order, immediate or post-completion answer explanations. Timed expiry is checked server-side; restarting records a used expired attempt. |
| Practical evaluation | Student response and optional HTTPS evidence/recording link; faculty rubric scores and feedback; failed work may be resubmitted. Passed tasks and completed course records are immutable. Required practical tasks and feedback gate completion and awards. |
| Achievements | Per-attempt certificates, verification link and QR, Classic/Modern template selection, signatory/footer settings, SVG badge, stars, first/latest completion, best/latest final knowledge score and repeat completion history. |
| Career guidance | Admin-maintained pathway domains and qualifications, latest valid course evidence, domain gaps, recommended courses, optional Gemini explanation and explicit formula. No score stacking for retakes. |
| Faculty authoring | Structured forms for modules, lessons, outcomes, questions, rubric activities, ordering, prerequisites, grading weights, enrollment dates and deadlines. Incomplete questions can be saved as drafts. |
| Source to draft | PDF/DOCX/PPTX text extraction with page/paragraph/slide references, source preview, outcomes/difficulty/question settings, consent, Admin-selected Gemini/Groq/Vertex AI course draft, exact quote validation, per-question faculty review and student preview. Never auto-publishes. |
| Question bank | Create/edit/review/archive reusable questions; insert reviewed questions into the course editor. Changes to an inserted question do not change the original bank item. |
| Faculty oversight | Assigned sections only; individual profiles and evidence, course progress, elapsed/active/assessment duration, inactivity flags, pending practical grading, shared feedback/private notes, section/competency reports and CSV. |
| Admin | Existing user/role/approval/settings/credential/audit controls plus ownership transfer, publication history, academic corrections, competency definitions, AI request caps/jobs and maintenance procedures. |
| Notifications | Role-specific inbox, unread bell/count polling, mark-read/open actions, assignment/deadline notices, practical submissions, grades, achievements and scoped faculty announcements. |
| Public interface | Reworked landing content, actual counts, unchanged three campus carousel images, manual controls/pause/reduced-motion support, mobile navigation, accessible auth dialogs and working Terms/Data use links. |

## Deliberate operating limits

- Scanned/image-only documents are flagged for external OCR. The app does not claim to extract readable text that is absent.
- AI requires private provider credentials in the environment. No provider credentials are committed. Without AI, manual authoring and rules-based career matching work normally. Course generation has no application-level 24-hour request cap; provider quotas, rate limits, context limits and billing still apply.
- Source generation runs as a bounded HTTP request (60-second provider timeout), with a job result log. It is not a distributed background queue. A process termination can leave a job marked running; operators should inspect provider/host status before retrying.
- Source material is limited to 8 MB, 80 PDF pages/slides and 100,000 extracted characters. Office decompression has entry/size limits. Personal supporting files are private database blobs, at most 2 MB each and 10 files per student. Persistent files do not rely on Render's ephemeral filesystem.
- Practical recordings are submitted as accessible HTTPS links. There is no built-in video recorder or plagiarism detector. A faculty member must be assigned to a student's active section before enrolling in a course with required practical work.
- All lessons/module quizzes are required. Practical activities may be marked optional; optional activities do not gate awards or contribute to required practical weighting. Deadline notices identify due dates; deadlines are advisory and do not erase or lock late learning.
- Academic section names are globally unique. Use distinct labels for cohorts (for example `BSTM 4-1 2026-2027`). Canonical domain names are kept stable for historical scores; Admin maintains their definitions and pathway mappings.
- Account creation by Google still requires institutional details; Faculty still needs Admin approval. The user specifically requested a public Student/Faculty selector, so that takes precedence over the attached document's Student-only signup suggestion.
- There is no automated email invitation or reset-mail delivery. Admin can create faculty, approve requests and reset password access. Google account linking retains the existing verified-identity protections.
- Maintenance exposes health and backup/restore **procedures**, not a dangerous web database restore or public dump. Run provider backups/restores privately and verify an isolated restore before production changes.
- Four complete starter practice courses remain available through `npm run seed:student`. Faculty must align and validate academic content and the proposed additional tourism tracks; AI drafts are not validated curriculum.

## Assessment and matching policy

Every required module quiz, final assessment and required practical task must meet the published course passing score. Completion also checks required feedback. The course's quiz/final/practical weights total 100 and determine the certificate grade. Stars: grade below 85 = one, 85–94 = two, 95–100 = three, after passing all requirements. Existing attempts preserve the policy and questions captured at enrollment.

For career alignment, use the latest completed attempt once per course, average final knowledge scores per domain, and use the latest diagnostic only where course evidence is absent. Faculty rubric scores from **the same latest completed attempts** provide practical evidence. Where both exist, domain alignment = 70% knowledge + 30% practical; without practical evidence it remains knowledge-only. Ongoing/unlocked courses, optional tasks and self-declared qualifications do not add earned competency. A gap is missing evidence or a domain score below 75. Strong alignment requires all required areas assessed, no gap and an average of at least 85. These are published initial rules requiring faculty validation, not an employment probability.

## Upgrade and deployment

1. Review the feature branch and take a private database backup.
2. Install with `npm ci` (Node 24 recommended; minimum 22.13).
3. Run `npm run migrate`. It adds Course/Profile/CareerPath columns and new portal tables; it does not force sync, delete learning attempts or replace existing courses.
4. Keep Render's existing start command `npm run migrate && npm start`. No reset/reseed command is required.
5. For a preview, push the feature branch only after approval and connect a separate staging Render service with a **separate database**, session secret and staging Google callback.
6. In Admin, approve faculty and assign their sections. Assign ownership of legacy starter courses, or let faculty create new courses. Ownership does not grant access to students outside assigned sections.
7. Configure optional Gemini variables privately. AI status and request cap are visible in Admin > AI operations; keys are not displayed.
8. Smoke-test actual Aiven migration, live Google login and real Gemini generation on staging before production deployment.

## Validation

`npm test` covers the existing authentication/student/admin suite plus course validation, PDF/DOCX/PPTX extraction, source-grounding checks, AI request caps, assigned-section authorization, version snapshots, saved answer conflicts, practical rubric gating, credentials, corrections, announcements and ownership transfer. Tests use isolated Node SQLite and mocked Google/Gemini providers. They do not alter Aiven or claim to verify a live provider exchange.

Browser QA exercises the real HTTP app at 1440px and 390px: all role pages, actual course-editor publication, error preservation, server-restored answers, auth dialogs, mobile navigation, carousel controls and horizontal overflow. No original carousel asset was replaced.

Implementation references: [Gemini generateContent API](https://ai.google.dev/api/generate-content), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [PDF.js Node text extraction](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs), and [Mammoth raw text extraction](https://github.com/mwilliamson/mammoth.js).
