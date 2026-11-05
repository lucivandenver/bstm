# Large multi-file course generation review

Branch: `fix/large-multifile-course-generation`

Base: `0ddb774` (`origin/main`, merged PR #13).

## Problem and resulting behavior

The screenshot shows 14.95 MB, 8.85 MB and 10.95 MB PDFs. The route accepted only 4 MB per file, extraction separately accepted only 8 MB, the multipart batch was limited to eight files/32 MB, and all extracted text had to fit within 100,000 characters. The generic upload failure concealed which boundary failed. The separate manual editor opened an empty course because generation had not succeeded.

Faculty now selects related files, a competency area, question count and permission, then chooses **Upload & generate course**. Learning outcomes are optional and can be derived from the material. The browser uploads files sequentially into one saved private collection, reports individual errors and skips confirmed files on retry. Failed files prevent automatic generation until resolved; successfully extracted files remain accessible through the saved collection link. File content hashes prevent duplicate imports on retry.

The source collection is analyzed in bounded batches. Every character is included, with split references for long sections. Each batch produces validated lessons and MCQs with correct answers, explanations and supporting source quotes. Results are combined into one unpublished course with unique IDs. No partial course is persisted if a later batch fails. Large collections get at least one question per generated module, even when that increases the requested total.

The generation request returns a job/status page promptly. Faculty can return through generation history and choose **Preview generated course** or **Edit lessons & answers** once complete. Preview shows the student experience; the editor exposes answer keys and source references for review. Faculty verifies answers and publishes through the existing publish checks. Repeated starts resume the same active job rather than duplicating provider calls. One job runs per Faculty account.

## Capacity and operating boundaries

- PDF, DOCX, PPTX and UTF-8 TXT; 100 MB per file. Legacy binary DOC must be saved as DOCX/PDF.
- No eight-file cap in the browser selection queue. Files upload one at a time. Non-JavaScript multipart requests remain bounded to 20 files/100 MB. Aggregate buffering is bounded even without Content-Length.
- Each collection supports 1,000,000 extracted characters and 10,000 sections; each PDF/PPTX supports up to 300 pages/slides. Longer collections must be divided into separate courses. Limits are explicit; content is never silently truncated for AI analysis.
- Text extraction reads selectable PDF text. Image-only/scanned PDFs need OCR or a selectable-text version; no OCR service has been added in this change.
- Generation runs inside the web service process. The database retains sources and job outcome, but it is not a separate durable worker. If Render restarts during generation, polling marks the interrupted request retryable. No completed source collection is lost.
- Provider 429/temporary 5xx/network failures receive bounded retries; invalid or unsupported answers still fail validation. Provider availability and quota remain external dependencies.

## Icons

Seven icons in Who It's For/Who Benefits use locally served Microsoft Fluent 3D assets for Students, Faculty, Campus, Tourism and Research. Existing content and carousel remain.

The favicon is the requested `✈️` emoji in SVG, with a new cache version. Installed-app icons use the Fluent 3D airplane in 192/512 px and a maskable variant, with new filenames to refresh prior artwork. Existing installed apps may need to be reinstalled if the OS retains the old launcher icon. MIT source attribution is in `public/images/fluent-emoji/README.md`.

## Verification

Commands:

```sh
npm test
git diff origin/main...HEAD
```

The automated suite passes 46 tests. New coverage includes:

- Real parsing and HTTP upload of a valid PDF at exactly 100 MB, plus rejection above 100 MB.
- Incremental 15 MB + 9 MB + 11 MB DOCX uploads; collections beyond the old text/combined-byte limits; duplicate retry and ownership checks; informative oversized-file JSON response.
- Background multi-batch generation, resume/status privacy, complete questions/answers, preview/editor routes and reviewed publication.
- Failure in a later AI batch leaves sources intact and saves no incomplete course.
- Planning a 975,000-character source retains every character and fits the course module limit.

Browser checks passed at 320, 390 and 1440 px: seven 3D icons loaded, landing/upload pages had no horizontal overflow, and a real browser queued 15/9/11 MB files, started background generation, displayed completion actions and opened the generated preview. Provider success in browser/HTTP tests uses controlled responses; the separate live test below validates the actual API.

Live Gemini check with synthetic teaching material and `gemini-3.5-flash`: the provider initially returned 503, bounded retries recovered, and both batches completed:

```json
{"ok":true,"modules":2,"questions":4,"answersPresent":true,"published":false}
```

## Deployment and review

No schema changes or new production dependencies. Keep existing private Gemini/Google/MySQL settings; no secrets are committed. No production database or Render deployment was changed during implementation. Push/merge remains subject to the user's approval.

Core source: `services/sourceLimits.js`, `sourceExtraction.js`, `sourceUploadStorage.js`, `courseAi.js`, `courseJobs.js`, Faculty routes/controller/templates, `public/js/source-upload.js`, `course-job.js`, manifest/favicon and landing assets. Tests: `tests/bulkCourses.test.js`.
