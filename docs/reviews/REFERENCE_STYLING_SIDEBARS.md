# Reference styling and sidebar branding

Prepared November 3, 2026 (Philippines). Branch: `fix/reference-styling-sidebar-branding`. Base: main `d2c0f81`, after PR #7 was merged.

Implements the actual website requests in the shared conversation “Ibalik ang Dating Design”. That conversation's previous output was an image preview only.

- Restore the pink-to-green statistics gradient while retaining the updated labels and database totals on Home/About.
- Restore How It Works styling: circular gradient step numbers, connecting lines, softly tinted preview panel and Fluent 3D icons. Retain the current text; never restore the sample 78%/94% claims.
- Restore Fluent 3D icons in the six System Features cards without changing their descriptions or restoring disconnected arrows/footer claims. Assets are served locally with the Microsoft license and source provenance.
- Change desktop/mobile header hover to pink. “Who It's For” in navigation/footer now points to `/#about-significance` (Significance of the Study), with space for the sticky header.
- Round public box-shaped components and shared role cards/buttons/fields.
- Use the existing CareerBridge wordmark at the top of Student, Faculty and Admin sidebars. Preserve each brand link's role dashboard destination. Remove the bottom ID/public-site content from all three sidebars; account records and profile details are retained.

No backend, database, authentication, learning/scoring, course-generation or credential changes. Campus carousel images, About student image, hero learning journey and other content remain. A visible-text comparison against the base confirmed that Home and System Features copy is unchanged.

Validation: `npm test` passed **38/38** tests. Headless Chromium passed at **320, 390, 768 and 1440 px**, checking asset loading, gradients, pink hover, navigation target, bounded login/register cards, carousel preservation, About photo, all three sidebar logos and role destinations, removed sidebar footers, mobile menus, no horizontal overflow and no browser script errors.

Files to inspect: `public/css/public-content.css`, `public/css/public-ui.css`, `public/css/portal.css`, `views/home.xian`, the `systemFeatures`, `publicHeader`, `studentTop`, `facultyTop` and `adminTop` partials, and `public/images/fluent-emoji/`.

```sh
git status --short --branch
git diff origin/main --stat
git diff origin/main
npm test
```

This branch is prepared locally for review. Upload and PR creation require the user's approval to push; merging into main is a separate action. No environment values or migration are needed for these styling changes.
