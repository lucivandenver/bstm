import { AiJob } from "../models/portalModels.js";
import { generateCourse } from "./courseAi.js";
import { generationError } from "./courseGenerationErrors.js";
const active = new Map();
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
        if (jobId) active.set(jobId, progress);
      },
    })
      .catch(reject)
      .finally(() => {
        if (jobId) active.delete(jobId);
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
  // Mark it retryable instead of displaying a permanent spinner.
  if (job.status === "running" && !active.has(job.id))
    await job.update({ status: "failed", errorCode: "COURSE_JOB_INTERRUPTED" });
  const progress = active.get(job.id);
  return {
    id: job.id,
    status: job.status,
    sourceId: job.sourceId,
    ...(progress || {}),
    ...(job.courseId
      ? {
          redirect: `/faculty/courses/${job.courseId}/edit`,
          preview: `/faculty/courses/${job.courseId}/preview`,
        }
      : {}),
    ...(job.status === "failed"
      ? { code: job.errorCode, message: generationError(job.errorCode).message }
      : {}),
  };
}
