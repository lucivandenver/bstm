# Reliable course generation and provider recovery

Branch: `fix/resilient-course-ai`, based on merged PR #14 (`7c073e2`).

## Diagnosis

The screenshots show provider quota/rate-limit and temporary availability failures. They do not show invalid uploaded files. A larger raw upload limit does not increase the AI account's request or token quota. The exact Render project quota cannot be inspected from the local repository.

The old provider transport retried 429/5xx after only one/two seconds without reading Retry-After or Gemini RetryInfo. Every failed generation restarted the source from its first batch. Separate Faculty jobs could use the same key concurrently. The failed page kept a preparing heading and sent Faculty back to the source form.

## Changes

- Shared course-provider queue, configurable request spacing, exponential backoff with jitter, Retry-After/RetryInfo handling and a maximum of four attempts. Long waiting periods return a retry time rather than holding the UI indefinitely. Provider daily quota, zero available quota, authentication, temporary rate limit and outage have separate safe messages. Credentials/raw provider error bodies are never displayed.
- `AiJobs.state` stores validated batch checkpoints, sanitized generation options, a content/settings fingerprint and recovery details. A compatible failed job resumes its existing ID. There is no application-level 24-hour course-generation cap; configured provider quota, rate limits, and billing still apply. Completed drafts remain unpublished and require Faculty answer review.
- Checkpoints survive request/page reloads and service restarts. Cached sections are revalidated before reuse. Changing the source/options invalidates the fingerprint. Invalid or incomplete later batches cannot save a partial course.
- Failed job pages display **Generation paused**, saved-section count, safe diagnostic code/reference, provider waiting countdown and **Resume generation**. Old jobs created before checkpoint storage can still reopen their saved materials and start the new flow.
- Gemini remains supported; recommended course-specific setting is `gemini-3.1-flash-lite`. Career guidance keeps its existing Gemini configuration.
- Optional Groq primary or explicitly configured independent backup using `openai/gpt-oss-20b`, strict JSON Schema output and the same source/answer validation. Provider consent identifies the configured provider(s); changing providers requires renewed permission before a saved job can send materials to the new provider. Groq requires its own private API key.
- `npm run ai:course-check` tests the selected provider using a synthetic teaching paragraph without writing any course/student records.

## Recommended Render setup

Keep the existing private `GEMINI_API_KEY`. Add/update:

| Variable | Value |
| --- | --- |
| `COURSE_AI_PROVIDER` | `gemini` |
| `COURSE_GEMINI_MODEL` | `gemini-3.1-flash-lite` |
| `COURSE_AI_INTERVAL_MS` | `12000` |

The new course-specific model overrides the older global `GEMINI_MODEL` for courses only. Actual project quota should inform request spacing.

Use Start Command `npm run migrate && npm start`. Migration adds the nullable JSON checkpoint column to existing `AiJobs` without resetting records; new installations create it through normal sync. Run the existing migration before serving this version.

Optional Groq: add private `GROQ_API_KEY`, set `GROQ_MODEL=openai/gpt-oss-20b`, then either use `COURSE_AI_PROVIDER=groq` or retain Gemini primary and set `COURSE_AI_FALLBACK=groq`. Defaults do not enable an unconfigured backup. Groq uses smaller 6,000-character batches; provider context, token, rate, and account quotas still apply. Higher provider quota or smaller topics may be necessary; this change does not promise unlimited free inference.

Raw upload support remains 100 MB per file. Text collection and course-size limits still apply. Scanned/image-only PDFs still need OCR/selectable text.

## Validation

- Full automated suite: 51 tests, including existing upload/learning/award/auth workflows.
- Provider tests use a fake clock to verify Retry-After, hard quota stop, no retries for authentication errors, Groq credential separation, strict schema and independent backup recovery.
- Integration test fails a later batch, confirms no partial course is saved, then resumes the same job and requests only the remaining batches.
- Additive migration is applied twice to legacy tables and preserves existing course/attempt data while adding checkpoint storage.
- Browser test at 390/1440 px: quota pause, saved count, reload, Resume, remaining-batch-only generation and Preview/Edit actions. Mock provider responses isolate the recovery path.
- Actual API test with synthetic material and the existing Gemini key succeeded using `gemini-3.1-flash-lite`: 10.7 seconds, two modules, three questions, unpublished draft. This sample timing is not a latency guarantee. Groq has contract/fallback tests but no live Groq call because no Groq key was supplied.

## Limits

There is no provider that can guarantee unlimited free, fast, always-available course generation. Free tiers have account/project-specific limits. A real daily quota exhaustion cannot be fixed by retries or a code change; the quota must reset, the account plan must change, or an independently configured provider must be used.

The service runs generation in-process. Checkpoints are durable, but a restart still requires Faculty to resume the job. The in-process shared queue/pacing is designed for the current single web-service instance; multiple instances would need a distributed queue/rate limiter.

No production database or Render environment was changed. No push or merge is included without the user's approval.

Primary references checked during implementation:

- https://ai.google.dev/gemini-api/docs/troubleshooting
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/pricing
- https://console.groq.com/docs/structured-outputs
- https://console.groq.com/docs/rate-limits
