# Review package: complete learning portals

Working copy: `/workspace/scratch/30b73cec05a0/bstm`

Branch: `feature/complete-learning-portals`

Base main: `39f5ab691103b8ce482c10dd18594e2e88626881`

The initial working tree was clean. No original campus carousel image was changed. No actual `.env`, passwords, API keys, database exports or uploaded user files are part of this change. This release is prepared locally; pushing the branch and deploying it require the repository owner's approval.

Read [coverage, operating limits and deployment instructions](LEARNING_PORTALS.md) first. Review the routes/controllers and the integration tests for behavior, then the views/CSS/JS for interface changes. Existing student, admin and authentication tests continue to pass.

## Validation output

```text
npm test
Tests: 28
Passed: 28
Failed: 0

npm run build:css
Completed successfully

git diff --check
No whitespace errors
```

Real browser checks at 1440px and 390px exercise role navigation, actual course publication, validation preserving form input, DOCX upload/source preview, diagnostic/course quiz saved-answer restoration and all three original carousel images. Provider exchanges are mocked in automated tests; live Aiven, Google and Gemini still require a staging smoke test. The migration upgrade test uses isolated SQLite, not the production MySQL database.

## Review commands after the feature branch is available locally

```powershell
git status
git log -1 --oneline
git diff main...feature/complete-learning-portals --stat
git diff main...feature/complete-learning-portals -- controllers routes models services migrations views public/css public/js
npm test
```

VS Code Source Control/Timeline and `git show feature/complete-learning-portals` also show the committed source diff. The commands run here and their outputs are shown in the ChatGPT activity/tool outputs. Local VS Code will only show this release after its branch has been pushed and fetched.

## Changed files

| Status | File |
| --- | --- |
| Modified | [README.md](../README.md) |
| Modified | [controllers/adminController.js](../controllers/adminController.js) |
| Created | [controllers/adminExtensions.js](../controllers/adminExtensions.js) |
| Modified | [controllers/authController.js](../controllers/authController.js) |
| Modified | [controllers/facultyController.js](../controllers/facultyController.js) |
| Modified | [controllers/homeController.js](../controllers/homeController.js) |
| Created | [controllers/portalController.js](../controllers/portalController.js) |
| Modified | [controllers/studentController.js](../controllers/studentController.js) |
| Modified | [docs/ADMIN_ACCOUNTS.md](../docs/ADMIN_ACCOUNTS.md) |
| Created | [docs/LEARNING_PORTALS.md](../docs/LEARNING_PORTALS.md) |
| Created | [docs/REVIEW_LEARNING_PORTALS.md](../docs/REVIEW_LEARNING_PORTALS.md) |
| Modified | [docs/STUDENT_SETUP.md](../docs/STUDENT_SETUP.md) |
| Modified | [index.js](../index.js) |
| Modified | [middleware/security.js](../middleware/security.js) |
| Modified | [migrations/student.js](../migrations/student.js) |
| Modified | [models/adminModels.js](../models/adminModels.js) |
| Modified | [models/learningModels.js](../models/learningModels.js) |
| Created | [models/portalModels.js](../models/portalModels.js) |
| Modified | [package-lock.json](../package-lock.json) |
| Modified | [package.json](../package.json) |
| Created | [public/css/landing.css](../public/css/landing.css) |
| Created | [public/css/portal.css](../public/css/portal.css) |
| Created | [public/js/course-editor.js](../public/js/course-editor.js) |
| Created | [public/js/portal.js](../public/js/portal.js) |
| Modified | [public/js/student.js](../public/js/student.js) |
| Modified | [public/tailwind.css](../public/tailwind.css) |
| Modified | [routes/admin.js](../routes/admin.js) |
| Modified | [routes/faculty.js](../routes/faculty.js) |
| Modified | [routes/index.js](../routes/index.js) |
| Modified | [routes/student.js](../routes/student.js) |
| Created | [services/courseAi.js](../services/courseAi.js) |
| Created | [services/courseAuthoring.js](../services/courseAuthoring.js) |
| Created | [services/evidence.js](../services/evidence.js) |
| Modified | [services/learning.js](../services/learning.js) |
| Created | [services/portalLearning.js](../services/portalLearning.js) |
| Created | [services/sourceExtraction.js](../services/sourceExtraction.js) |
| Modified | [services/validation.js](../services/validation.js) |
| Modified | [tests/admin.test.js](../tests/admin.test.js) |
| Created | [tests/migrationPortals.test.js](../tests/migrationPortals.test.js) |
| Created | [tests/portals.test.js](../tests/portals.test.js) |
| Modified | [views/about.xian](../views/about.xian) |
| Created | [views/accountInformation.xian](../views/accountInformation.xian) |
| Created | [views/admin/academic.xian](../views/admin/academic.xian) |
| Created | [views/admin/ai.xian](../views/admin/ai.xian) |
| Modified | [views/admin/careers.xian](../views/admin/careers.xian) |
| Created | [views/admin/competencies.xian](../views/admin/competencies.xian) |
| Modified | [views/admin/courses.xian](../views/admin/courses.xian) |
| Created | [views/admin/history.xian](../views/admin/history.xian) |
| Created | [views/admin/maintenance.xian](../views/admin/maintenance.xian) |
| Modified | [views/admin/reports.xian](../views/admin/reports.xian) |
| Modified | [views/admin/settings.xian](../views/admin/settings.xian) |
| Created | [views/faculty/announcements.xian](../views/faculty/announcements.xian) |
| Created | [views/faculty/assignments.xian](../views/faculty/assignments.xian) |
| Created | [views/faculty/bank.xian](../views/faculty/bank.xian) |
| Created | [views/faculty/courses.xian](../views/faculty/courses.xian) |
| Modified | [views/faculty/dashboard.xian](../views/faculty/dashboard.xian) |
| Created | [views/faculty/editor.xian](../views/faculty/editor.xian) |
| Created | [views/faculty/evaluations.xian](../views/faculty/evaluations.xian) |
| Created | [views/faculty/monitoring.xian](../views/faculty/monitoring.xian) |
| Created | [views/faculty/preview.xian](../views/faculty/preview.xian) |
| Created | [views/faculty/reports.xian](../views/faculty/reports.xian) |
| Created | [views/faculty/source.xian](../views/faculty/source.xian) |
| Created | [views/faculty/student.xian](../views/faculty/student.xian) |
| Created | [views/faculty/students.xian](../views/faculty/students.xian) |
| Created | [views/faculty/upload.xian](../views/faculty/upload.xian) |
| Modified | [views/home.xian](../views/home.xian) |
| Modified | [views/login.xian](../views/login.xian) |
| Modified | [views/partials/adminTop.xian](../views/partials/adminTop.xian) |
| Modified | [views/partials/facultyTop.xian](../views/partials/facultyTop.xian) |
| Created | [views/partials/notificationBell.xian](../views/partials/notificationBell.xian) |
| Modified | [views/partials/studentTop.xian](../views/partials/studentTop.xian) |
| Created | [views/portalNotifications.xian](../views/portalNotifications.xian) |
| Modified | [views/register.xian](../views/register.xian) |
| Modified | [views/student/achievements.xian](../views/student/achievements.xian) |
| Created | [views/student/activities.xian](../views/student/activities.xian) |
| Modified | [views/student/assessment.xian](../views/student/assessment.xian) |
| Modified | [views/student/careers.xian](../views/student/careers.xian) |
| Modified | [views/student/catalog.xian](../views/student/catalog.xian) |
| Modified | [views/student/course.xian](../views/student/course.xian) |
| Modified | [views/student/dashboard.xian](../views/student/dashboard.xian) |
| Modified | [views/student/learn.xian](../views/student/learn.xian) |
| Modified | [views/student/profile.xian](../views/student/profile.xian) |
| Modified | [views/student/quiz.xian](../views/student/quiz.xian) |
| Modified | [views/student/results.xian](../views/student/results.xian) |
| Created | [views/student/review.xian](../views/student/review.xian) |
