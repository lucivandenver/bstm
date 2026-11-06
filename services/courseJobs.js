import { AiJob } from "../models/portalModels.js";
import { generateCourse, generateBlueprint } from "./courseAi.js";
import { courseAiConfiguration } from "./courseAiProvider.js";
import { generationError, safeGenerationError } from "./courseGenerationErrors.js";
import { signalCourseJob } from "./courseLive.js";
const active = new Map();
export async function startBlueprintJob(userId, source, options) {
  const running = await AiJob.findOne({ where: { userId, status: "running", type: "course-draft" } });
  if (running) {
    if (active.has(running.id)) {
      if (Number(running.sourceId) === Number(source.id)) return running;
      throw generationError("COURSE_ALREADY_RUNNING");
    }
    await running.update({ status: "failed", errorCode: "COURSE_JOB_INTERRUPTED" });
  }
  const config = await courseAiConfiguration();
  if (!config.ready) throw generationError("COURSE_AI_NOT_CONFIGURED");
  const savedOptions = {
    competencyAreas: options.competencyAreas, domain: options.domain, level: options.level || "Foundation",
    outcomes: options.outcomes, questionCount: Number(options.questionCount), courseTitle: options.courseTitle || "",
    consent: options.consent === "yes", consentProviders: config.fallback ? ["gemini", "groq"] : [config.provider],
  };
  const job = await AiJob.create({ userId, sourceId: source.id, type: "course-draft", status: "running", state: { phase: "blueprint", options: savedOptions, total: 1, batches: [], provider: config.provider, model: config.model } });
  active.set(job.id, { completed: 0, total: 1, message: "Preparing a course blueprint for faculty review…" });
  (async () => {
    try {
      const blueprint = await generateBlueprint(source, savedOptions, status => {
        active.set(job.id, { completed: 0, total: 1, ...status }); signalCourseJob(job.id);
      });
      await job.update({ status: "review", errorCode: null, state: { ...job.state, blueprint } });
    } catch (error) {
      const safe = safeGenerationError(error, "provider", job.id);
      await job.update({ status: "failed", errorCode: safe.code, state: { ...job.state, reference: safe.reference, retryAt: safe.retryAt || null } });
    } finally {
      active.delete(job.id); signalCourseJob(job.id);
    }
  })();
  return job;
}
export async function startCourseJob(userId, source, options) {
  const running = await AiJob.findOne({
    where: { userId, status: "running", type: "course-draft" },
  });
  if (running) {
    if (active.has(running.id)) {
      if (Number(running.sourceId) === Number(source.id)) return running;
      throw generationError("COURSE_ALREADY_RUNNING");
    }
    await running.update({
      status: "failed",
      errorCode: "COURSE_JOB_INTERRUPTED",
    });
  }
  return new Promise((resolve, reject) => {
    let jobId;
    // The database job is admitted before returning. Rendering/polling is independent
    // of a long provider request. Only validated complete drafts are persisted.
    generateCourse(userId, source, {
      ...options,
      onJob(job, total) {
        jobId = job.id;
        active.set(job.id, {
          completed: 0,
          total,
          message: "Preparing your course…",
        });
        resolve(job);
      },
      onProgress(progress) {
        if (jobId) {
          active.set(jobId, progress);
          signalCourseJob(jobId);
        }
      },
    })
      .catch(reject)
      .finally(() => {
        if (jobId) {
          active.delete(jobId);
          signalCourseJob(jobId);
        }
      });
  });
}
export async function courseJobStatus(userId, id) {
  const job = await AiJob.findOne({
    where: { id, userId, type: "course-draft" },
  });
  if (!job)
    throw Object.assign(new Error("Generation request not found."), {
      status: 404,
    });
  // A single-instance service restart cannot continue an in-memory provider task.
  // Mark it retryable instead 