# Admin and account registration release

## Scope

This branch adds Admin dashboards, account management and faculty review, section/faculty assignments, course publication/settings oversight, certificate revocation, announcements, configurable career pathway rules, CSV learning reports, account security, settings and audit logs. It retains XianFire/Express, Sequelize/MySQL and `.xian` views. Approved faculty have a scoped monitoring page for assigned sections and a profile page. Full faculty course upload/AI authoring and practical assessment grading are separate work, not included here.

## Deployment / migration

Back up the target database before deploying this schema update. `npm run migrate` adds `facultyId`, `gender`, `approvalStatus` and `sessionVersion` to Users and creates administration tables without dropping existing learning records. The current Render start command (`npm run migrate && npm start`) applies it before startup after merge/deploy.

Existing users retain their role and records. Existing faculty receive approved status; new self-registered faculty start pending. Existing students can complete the newly required gender on My Profile. Default section names are added only if absent, and existing student section names are retained as section entries. Section names are globally unique; use a distinct name for each cohort if cohorts must be kept separate.

## Default system owner

The reserved default owner is `bstm4thyear.mbc@gmail.com`. `ADMIN_EMAIL` may override it for a separate environment. Public registration cannot claim this email or create Admin accounts.

Migration provisions the owner account. With no bootstrap password it is Google-only; it can bind its verified Gmail identity on the first Google login. A Google client, authorised callback URL and provider consent/test-user configuration are still required. The OAuth client owner and the application's Admin role are separate concepts; the application bootstrap explicitly reserves this owner.

To enable password login, generate a new private password on your laptop:

```powershell
npm run admin:password
```

Copy its random output into the Render environment variable `ADMIN_INITIAL_PASSWORD`, then deploy. The value is never written to repository source or printed by migration. Use at least 14 characters and at most 72 bytes. Bootstrap sets it only when the owner has no existing password, or when explicitly provisioning a previously non-Admin owner account; it does not overwrite an existing Admin password on every restart. Once provisioned, remove the bootstrap variable from Render and change the password in Admin > My account. Alternatively, sign in with Google and set a password in My account within 10 minutes of that Google login.

If the reserved email already belongs to an unverified password account, migration requires the privately configured initial password before granting ownership. The bootstrap never gives a public registrant Admin permission merely because they typed the owner's email. It does not delete the account's historical learning records.

## Student and faculty registration

Both the standalone register page and the landing-page register modal use the same form and visual style.

- Student: full name, Student ID, section, gender, email and password.
- Faculty: full name, Faculty ID, email and password. Section and student gender fields are hidden, disabled and ignored on the backend.
- New faculty remain pending until Admin approves them. Rejected, pending or inactive accounts cannot access protected portals.
- Validation is repeated on the server; submitting `role=admin` or `account_type=admin` cannot elevate a public account.
- IDs and emails have database uniqueness constraints.

## Google intent separation

`/auth/google?intent=login` signs in registered accounts only. An unknown Google account returns to the login modal with a red "This account is not yet registered. Please register first." message. It creates no User record.

`/auth/google?intent=register&role=student` or `role=faculty` verifies Google identity and saves a short-lived pending registration in the server session. It pre-fills only the editable full name; the verified account email is displayed read-only. The user must still enter institutional ID and student-specific fields. No local password is required for this Google-backed account. Posting a different email, Google ID or elevated role cannot override the verified server-side identity. Account creation happens only after the complete form passes validation. Pending registration expires after 10 minutes and can be cancelled from the form.

Existing password accounts are not silently linked by email. Sign in with the password and explicitly Connect Google on the role's account/profile page. The reserved, pre-provisioned owner Gmail is the sole email-linking exception after Google token verification.

## Admin controls

- Accounts: search/pagination, create Student/Faculty, edit academic details, approve/reject faculty, activate/deactivate and reset passwords.
- Only the configured owner can grant/manage Admin roles. Self-deactivation/demotion and owner deactivation/demotion are blocked; the last active administrator is protected.
- Password resets increment a session version, invalidating previous sessions. Role/active/approval status is rechecked on protected requests.
- Sections: assign approved active faculty. Renaming a section updates associated student section labels; archiving hides it from new registration.
- Courses: edit metadata, competency area, passing score and publication state. New settings increment course version; existing attempts retain their snapshots.
- Career pathways: manage required domains and active pathways used by student guidance. Rules still need faculty validation.
- Credentials: view issued certificates and revoke with a reason. Verification shows the revoked state and private student downloads are blocked.
- Announcements: publish/draft by audience, shown in the selected portals with escaped text.
- Reports: course/diagnostic tables and a CSV of all course attempts. Spreadsheet formula-leading text is escaped on export.
- Settings: institution, academic year, certificate footer and registration availability. OAuth/API/database secrets remain in the hosting environment, not in Admin screens.
- Audit: latest 200 records; passwords, tokens and full profiles are excluded. Academic/user records are archived or disabled, not hard-deleted.

## Review on Render before main

Render deploys the branch configured for a service. A local/unpushed change cannot be previewed on Render. Once the feature branch is pushed with approval, create a separate staging service linked to it, with a separate test MySQL database and a staging OAuth callback. Do not point staging migrations at the production database. The existing `bstm.onrender.com` service can remain linked to `main`. Only merge the PR after review. Creating a PR alone does not automatically create a free preview service.

## Validation

Run `npm test` for route-level and unit tests. Integration tests use isolated SQLite with mock Google identity/token exchange, never the live Aiven database. A real Aiven schema migration and live Google login still need a post-deployment smoke test. Test the owner login, unknown Google login notice, Google registration completion, faculty approval, assigned student scoping, credential revocation, settings and reports on the staging service before merging.
