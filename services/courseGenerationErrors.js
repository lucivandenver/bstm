import { randomBytes } from "node:crypto";
const messages = {
  COURSE_AI_NO_QUOTA: [
    "The provider reports no available quota for this model/project. Admin must check the free-plan model and project limits, enable quota, or configure another provider. Saved course sections can be resumed afterwards.",
    429,
  ],
  COURSE_AI_DAILY_QUOTA: [
    "The provider daily quota or credit allowance is exhausted. Wait for its reset or ask Admin to review the provider plan. Completed course sections are saved; resume afterwards.",
    429,
  ],
  COURSE_AI_CAPACITY: [
    "This collection is too large for the configured Groq request budget. Use Gemini for this collection or divide it into smaller courses. Your materials are saved.",
    422,
  ],
  COURSE_JOB_INTERRUPTED: [
    "The service restarted before generation finished. Your source collection and validated course sections are saved. Resume generation to continue.",
    503,
  ],
  COURSE_AI_NOT_CONFIGURED: [
    "AI drafting is not configured. Ask Admin to configure the selected Gemini or Groq provider. Your uploaded materials are saved.",
    503,
  ],
  COURSE_AI_AUTH: [
    "The AI provider rejected the credentials or permissions. Ask Admin to check the selected provider key and project access.",
    503,
  ],
  COURSE_AI_MODEL: [
    "The configured AI model is unavailable. Ask Admin to check the model setting for this provider key.",
    503,
  ],
  COURSE_AI_QUOTA: [
    "The AI provider is rate-limiting requests. Completed sections are saved. Resume after the indicated waiting period.",
    429,
  ],
  COURSE_DAILY_LIMIT: [
    "Your course generation limit for the last 24 hours has been reached. Your existing drafts remain available.",
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
    "The AI provider is temporarily unavailable. Completed sections are saved; resume generation when it recovers.",
    503,
  ],
  COURSE_AI_REQUEST: [
    "The provider could not accept this draft request. Ask Admin to check the model configuration.",
    503,
  ],
  COURSE_AI_TRUNCATED: [
    "The AI response ended before the draft was complete. Reduce the question count or split the source into smaller topics.",
    422,
  ],
  COURSE_AI_BLOCKED: [
    "The AI provider could not produce content for this source. Review the teaching material.",
    422,
  ],
  COURSE_AI_INVALID: [
    "The returned draft could not be validated. No incomplete course was saved. Try fewer questions.",
    422,
  ],
  COURSE_SOURCE_UNSUPPORTED: [
    "AI draft contained unsupported source references. No course was published. Review the source.",
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
    "Select one or more competency areas and choose 3–30 questions.",
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
