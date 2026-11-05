import { randomBytes } from "node:crypto";
const messages = {
  COURSE_JOB_INTERRUPTED: ["The service restarted before generation finished. Your source collection is saved. Open it and generate again.", 503],
  COURSE_AI_NOT_CONFIGURED: [
    "AI drafting is not configured. Ask Admin to configure a supported provider. Your uploaded source is saved and can be retried.",
    503,
  ],
  COURSE_AI_AUTH: [
    "The AI provider rejected the credentials or permissions. Ask Admin to check the Gemini API key and project access.",
    503,
  ],
  COURSE_AI_MODEL: [
    "The configured Gemini model is unavailable. Ask Admin to check GEMINI_MODEL for this API key.",
    503,
  ],
  COURSE_AI_QUOTA: [
    "The AI provider has reached its request limit. Your uploaded source is saved; retry after the provider limit resets or ask Admin to configure a fallback provider.",
    429,
  ],
  COURSE_DAILY_LIMIT: [
    "Your successful course generation limit for the last 24 hours has been reached. Your existing drafts and saved source materials remain available.",
    429,
  ],
  COURSE_ALREADY_RUNNING: [
    "A course draft request is already running for your account. Open generation history before starting another request.",
    409,
  ],
  COURSE_AI_TIMEOUT: [
    "The AI request timed out. Try fewer questions or a smaller source topic. Your uploaded text is safe.",
    503,
  ],
  COURSE_AI_UNAVAILABLE: [
    "The AI provider is temporarily unavailable. Your source is saved; retry later or ask Admin to configure a fallback provider.",
    503,
  ],
  COURSE_AI_REQUEST: [
    "The provider could not accept this draft request. Ask Admin to check the model configuration, then retry from your saved source.",
    503,
  ],
  COURSE_AI_TRUNCATED: [
    "The AI response ended before the draft was complete. Reduce the question count or split the source into smaller topics.",
    422,
  ],
  COURSE_AI_BLOCKED: [
    "The AI provider could not produce content for this source. Review the teaching material or use a manual draft.",
    422,
  ],
  COURSE_AI_INVALID: [
    "The returned draft could not be validated. No incomplete course was saved. Try fewer questions or split the source into smaller topics.",
    422,
  ],
  COURSE_SOURCE_UNSUPPORTED: [
    "AI draft contained unsupported source references. No course was published. Review the source and retry generation.",
    422,
  ],
  COURSE_SOURCE_INSUFFICIENT: [
    "The source does not contain enough relevant material for this draft. Add more text or lower the question count.",
    422,
  ],
  COURSE_SOURCE_INVALID: [
    "This source has no usable extracted text. Upload a text-based PDF, DOCX or PPTX again.",
    422,
  ],
  COURSE_SCHEMA_NOT_READY: [
    "Course storage is missing a required table or field. Ask Admin to run the existing database migration before retrying.",
    503,
  ],
  COURSE_STORAGE_BUSY: [
    "Course storage is busy. Wait a moment and retry; your uploaded source is retained.",
    503,
  ],
  COURSE_STORAGE_UNAVAILABLE: [
    "The course draft could not be saved. Ask Admin to check database connectivity and the reference in the service logs.",
    503,
  ],
  COURSE_INPUT: [
    "Choose a competency area, enter target outcomes and select 3–30 questions.",
    400,
  ],
};
export function generationError(code, message) {
  const [defaultMessage, status] =
    messages[code] || messages.COURSE_STORAGE_UNAVAILABLE;
  return Object.assign(new Error(message || defaultMessage), {
    status,
    code,
    isCourseGenerationError: true,
  });
}
export function safeGenerationError(error, stage = "unknown", jobId) {
  const dbCode = error?.original?.code || error?.parent?.code || "";
  let code = error?.isCourseGenerationError ? error.code : null;
  if (!code) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(dbCode))
      code = "COURSE_SCHEMA_NOT_READY";
    else if (
      ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "SQLITE_BUSY"].includes(
        dbCode,
      )
    )
      code = "COURSE_STORAGE_BUSY";
    else if (["TimeoutError", "AbortError"].includes(error?.name))
      code = "COURSE_AI_TIMEOUT";
    else if (stage === "input" && error?.status === 400) code = "COURSE_INPUT";
    else
      code =
        stage === "provider"
          ? "COURSE_AI_UNAVAILABLE"
          : stage === "parse" || stage === "validate"
            ? "COURSE_AI_INVALID"
            : "COURSE_STORAGE_UNAVAILABLE";
  }
  const safe = error?.isCourseGenerationError ? error : generationError(code);
  safe.reference ||= randomBytes(4).toString("hex");
  console.error(
    "[Course draft]",
    JSON.stringify({
      reference: safe.reference,
      stage,
      code: safe.code,
      ...(Number.isInteger(jobId) ? { jobId } : {}),
      ...([
        "ER_NO_SUCH_TABLE",
        "ER_BAD_FIELD_ERROR",
        "ER_LOCK_DEADLOCK",
        "ER_LOCK_WAIT_TIMEOUT",
      ].includes(dbCode)
        ? { databaseCode: dbCode }
        : {}),
    }),
  );
  return safe;
}
