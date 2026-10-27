# Student portal setup

## Requirements

- Node.js 22.13 or newer (Node 24 LTS recommended).
- MySQL or MariaDB running in Laragon; phpMyAdmin is the database management interface.
- A database named `BSTM`, or another name configured in `.env`.
- Google Cloud OAuth credentials to enable Google signup/sign-in.

The app remains XianFire: Express controllers/routes, Sequelize models, and Handlebars-backed `.xian` views. Run the Node server; opening the folder through Apache or Live Server does not execute it.

## Run on your laptop

In PowerShell:

```powershell
cd C:\laragon\www\BSTM
git pull origin main
npm install
Copy-Item .env.example .env
```

Skip `Copy-Item` if you already have `.env`; update it manually instead. Start MySQL in Laragon. Create the database in phpMyAdmin if it does not exist. Set the MySQL connection values in `.env`, and replace `SESSION_SECRET` with a random value (keep it stable across restarts):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Back up your existing database before the first migration. Then:

```powershell
npm run migrate
npm run seed:student
npm run xian
```

Open `http://localhost:3000`. Create a student account and complete My Profile before enrolling. Public signup always creates a Student; users cannot submit their own elevated role.

`npm run migrate` now preserves records. It adds missing student fields/tables, normalises email addresses and converts old `visitors` accounts into students. Existing `staff` accounts retain their role; they are not automatically promoted to faculty. Duplicate existing emails must be resolved before migration can proceed. Migration fails with a nonzero exit code and never force-syncs tables. MySQL schema changes are not transactional; take a backup and retry after correcting an error.

`npm run seed:student` adds four optional starter courses and does not overwrite existing courses. The course seed is practice material, not a faculty-approved curriculum or validated research instrument. Faculty/Admin course publishing screens are not part of this Student release. Without seeding or later publishing, the catalog displays an honest empty state.

## Google signup / sign-in

This integration authenticates a Google account (including Gmail) using OAuth/OpenID Connect. It does not request inbox access, send email OTPs, or send password-reset emails.

1. Open [Google Cloud Console](https://console.cloud.google.com/), select/create the project owned by the system administrator.
2. Configure Google Auth Platform branding and audience/consent settings. While the app is in testing, add the Google accounts that will test it.
3. Create an OAuth client with application type **Web application**.
4. Add the authorised redirect URI exactly:
   `http://localhost:3000/auth/google/callback`
5. Put the client credentials in your local `.env`:

```dotenv
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

6. Restart `npm run xian`, then choose **Sign up with Google** or **Sign in with Google** on the existing pages or landing-page modals.
7. A new Google user is redirected to the Student portal and must supply Student ID, section and the academic profile before learning.

A password account with the same email is not silently linked. Sign in with its password first, visit **My Profile**, then **Connect Google account** and choose the same email. This preserves the original learning records. Google is identified by its stable `sub`, with ID-token validation, verified email, state, nonce, PKCE and session regeneration. Tokens are not stored in the student profile or browser local storage.

For deployment, add the exact HTTPS callback URL to the OAuth client, update `APP_URL` and `GOOGLE_REDIRECT_URI`, set `NODE_ENV=production` and a strong `SESSION_SECRET`, and run behind a trusted HTTPS proxy. `APP_URL` also determines certificate verification links. Localhost links are only verifiable from the computer hosting the app. Keep credentials out of GitHub. No real Google credentials are included.

Google reference: [OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect).

## Student features and rules

- Profile: editable academic details, OJT, interests, languages, self-declared skills and qualifications. Account email cannot be changed through the profile form.
- Catalog: search, competency filter, details, prerequisites, enrollment and resume.
- Learning: persistent lesson checklist, module quizzes, locked sequential modules, final assessment and progress circle. Answers are graded on the server; answer keys are not rendered.
- Failed quizzes/finals can be retried. All submitted quiz scores stay in the attempt history. A passing module score stays passed when reviewing or retrying a quiz.
- Each course enrollment attempt snapshots the course version and requirements. Completing it issues one credential transactionally. A retake creates a new attempt without deleting previous credentials or scores.
- Certificates are downloadable PDFs with a clickable verification URL and unique credential ID. Badges are downloadable SVG files. There is no QR code in this release.
- Stars: final score 75–84 = 1, 85–94 = 2, 95–100 = 3 for the starter courses. These are achievement milestones, not employment credentials.
- Course activity is estimated from periodic active-tab heartbeats, excluding hidden/idle tabs. Elapsed days and estimated active minutes are shown separately. This is not proctoring or verified study time.
- Notifications are persisted for course starts and course completions, with a mark-all-read action.
- Results and PDF reports separate knowledge evidence from practical competence. Diagnostic retakes retain history.
- Public credential verification reveals the credential recipient's name, course, score and issue date to anyone holding the unguessable verification link; no Student ID, email or private profile is exposed. The Student achievements screen explains this before sharing.

## Career pathways and optional Gemini

The baseline uses eight starter knowledge questions across four areas. Completed course evidence uses the latest completed attempt per distinct course, then averages courses per domain. Diagnostic scores are used only where a domain has no completed course evidence. Ongoing or merely unlocked courses do not count as earned evidence. Repeating the same course does not multiply its weight.

Starter pathway labels use these transparent rules:

- Missing required-area evidence: **More evidence needed**.
- All required areas known, average at least 85, and every required area at least 75: **Strong learning alignment**.
- Otherwise: **Developing alignment**.

These thresholds and pathway mappings need faculty validation before academic/research interpretation. A numeric domain average is not an employment probability. Practical communication/workplace readiness needs faculty rubrics and observed performance in a future faculty release.

Without an AI key the system uses labelled rule-based pathways. To enable the optional AI explanation, configure:

```dotenv
GEMINI_API_KEY=your-private-api-key
GEMINI_MODEL=your-supported-gemini-model
```

Use a model available in your Google AI Studio project with `generateContent` and JSON output support; the example value in `.env.example` is configurable. Restart the server. On Career Pathways, the student explicitly consents to send only competency scores and pathway labels. No name, email, Student ID, OJT employer or free-text profile is sent. Guidance is limited to five requests per student per hour; provider usage/billing limits are managed in the provider account. AI explains the existing evidence and cannot change assessment grades or pathway ranking. Failure leaves the rule-based recommendations available. AI guidance is session-cached and cleared after new assessments.

Gemini reference: [Generate content API](https://ai.google.dev/api/generate-content).

The public pages now use a checked-in local Tailwind stylesheet. After changing Tailwind utility classes, rebuild with `npm run build:css`; normal startup does not depend on the Tailwind CDN.

## Verification

```powershell
npm test
```

The tests cover server-side grading, prerequisites, signup validation, role assignment, profiles, signed assessment challenges, ownership, full course completion, failed finals, duplicate submissions, PDFs, badges, retakes, template escaping and Google signup/linking decisions.

HTTP integration tests use Node's built-in SQLite through a test-only Sequelize adapter (`NODE_ENV=test` plus `TEST_DB_STORAGE`). Production uses MySQL. Tests never migrate or erase your Laragon database. Google token exchange and verification are mocked in the automated test: a real Google login still needs a manual smoke test with your OAuth client. The MySQL migration must also be checked against your backed-up local schema.

Manual checks after local setup:

1. Register a student; confirm Student ID and section are saved.
2. Sign up with Google using a configured test account; complete profiling.
3. Enroll, complete lessons, fail and retry a quiz, then pass the final.
4. Download the PDF and SVG and open the verification URL.
5. Retake the course; confirm the old certificate remains and new progress starts empty.
6. Sign in as another student; verify the first account's private attempts/downloads are inaccessible.
7. Try the profile, catalog and learning page on a phone-size screen.

## Scope remaining

Faculty course creation/upload/AI generation, practical grading, Admin management, institution-approved certificates/signatories, email password-reset delivery and a validated assessment/question bank remain separate implementation work. The existing Faculty/Admin dashboard remains a placeholder. No production secrets, academic approval or professional accreditation are implied by this release.
