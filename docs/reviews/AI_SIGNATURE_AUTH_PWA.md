# AI, signatures, account menus and public UI review

Branch: `fix/ai-signatures-auth-pwa`

Base: `19f2540` on `main`

## Result

- Faculty course generation and Student career guidance share server-side Gemini configuration. The working default is `gemini-3.5-flash`, verified against the provider using synthetic teaching material and learning evidence.
- PDF/DOCX/text extraction, editable course drafts, mandatory answer review, publishing, lesson progress, resume, quizzes and final assessments retain the existing application workflows. Generated drafts are unpublished until Faculty reviews and publishes them.
- Career guidance includes completed courses, valid award status and saved ongoing progress. Unfinished learning remains developing evidence. Gemini selects from predefined rule-ranked pathways; the server validates indexes and supplies the actual pathway titles. No employers or live job listings are fabricated.
- The career finder displays a cloud/magnifying-glass animation during the actual asynchronous request, handles errors, and invalidates stale results when learning evidence changes. Fixed a null career-interest error on the career page.
- Faculty/Admin signature uploads are decoded and processed on the server into transparent PNGs. Faculty changes return the credential configuration to Admin review; new awards wait for approval and both signatures. Existing issued awards retain their snapshots.
- Matching rounded auth inputs/buttons, full-width Faculty position/degree/qualification fields, pink public navbar hover without underlines, local 3D hero icons, outline workspace icons, and avatar dropdowns with Profile/Notifications/Logout.
- Install controls appear on the landing page only. Airplane favicon and PWA icons replace the launcher/tab artwork. The service worker refreshes public assets without caching private pages.

## Deployment

There is **no schema change** in this branch. Existing deployments must retain their current non-destructive migration procedure. Do not use forced database sync on production data.

1. Install updated dependencies with `npm ci`; `sharp` is now a production dependency.
2. In Render Environment, set `GEMINI_API_KEY` to the private provider key and `GEMINI_MODEL` to `gemini-3.5-flash`. The local private environment is ignored by Git and is not deployed through a commit.
3. Keep the existing session, Google OAuth and cloud MySQL settings.
4. After deployment, run `npm run ai:check` in the service shell if provider verification is needed. This sends one synthetic generation request and prints only a safe result summary.
5. Review the updated favicon/PWA artwork after the new service worker takes control. Previously installed OS launchers may require reinstallation to refresh their icon.

## Verification

Full suite command: `npm test`.

```text
tests 43
pass 43
fail 0
cancelled 0
skipped 0
```

The suite covers course extraction/generation/review/publishing, student learning and retakes, assessment and award rules, ownership/role access, transparent signature processing and approval resubmission, and anonymised career generation/cache invalidation.

Actual provider smoke-test summaries (synthetic inputs; no personal student records):

```json
{"check":"live-course-draft","ok":true,"modules":1,"questions":3,"reviewRequired":true,"published":false,"job":"completed"}
{"check":"live-career-guidance","ok":true,"matches":["Travel and Tour Operations"],"nextSteps":3}
```

Browser checks passed at widths 320, 390, 768, 1100 and 1440: public carousel preserved, auth form bounds and corners, close-to-home actions, header hover, landing-only install controls, all role account menus and logout, sidebar SVGs, signature previews/Admin persistence, retained course-generation inputs on errors, student outline and asynchronous career loader/error recovery. Browser error branches use intercepted provider failures; successful live generation was checked separately above.

## Boundaries

- Signature processing is intended for dark ink on plain light paper or an existing transparent PNG, up to 4 MB. It is not arbitrary photo segmentation. A preview is shown before submission.
- Text-based PDF, DOCX and supported text materials work with extraction. Scanned/image-only PDFs still need OCR or a text-based replacement; legacy `.doc` files should be saved as DOCX/PDF.
- AI results depend on provider availability and quota. Safe errors keep the saved source, draft and previous results intact.
- Career output suggests learning-aligned roles, not verified hiring vacancies. Ongoing courses do not become earned competency scores or certificates.
- The existing Forgot Password link leads to account help; this change does not add an outbound password-reset email service.
- No production database, Render environment, or production Google account was changed by local tests. No push or merge is included in this review.

## Review source

Main changes: `services/gemini.js`, `services/courseAi.js`, `services/careerAi.js`, `services/signatureProcessing.js`, corresponding controllers/routes, `public/js/career-finder.js`, `public/js/signature.js`, account/icon partials, public/portal styles, manifest and service worker.

To inspect from VS Code's integrated terminal:

```sh
git status --short
git branch --show-current
git diff origin/main...HEAD
npm test
```

Secrets belong only in private environment configuration. The repository contains placeholders, not provider keys or passwords.
