import { facultySignature } from './publicationCredentials.js';
import { Course, CourseAttempt, Credential, Notification, User } from '../models/learningModels.js';
import { QuizDraft, CredentialRequest } from '../models/portalModels.js';
import { starsFor, courseModuleAverage, moduleAssessmentResult, publishedAttemptSnapshot } from './learning.js';
import { fail } from './courseAuthoring.js';
export const tasksFor = a => a.snapshot.tasks || [];
export async function ensureCompletionCredential(attempt, user, score, transaction, module = null) {
  score ??= module ? null : courseModuleAverage(attempt);
  if (module && score < attempt.snapshot.passingScore) return null;
  if ((!module && (attempt.status !== 'completed' || score === null)) || attempt.snapshot.certificateEnabled === false) return null;
  const request = await CredentialRequest.findOne({ where: { courseId: attempt.courseId, status: 'approved' }, transaction });
  const course = await Course.findByPk(attempt.courseId, { transaction });
  const faculty = request ? await User.findByPk(request.facultyId, { transaction }) : course?.ownerId ? await User.findByPk(course.ownerId, { transaction }) : null;
  const signature = request && faculty?.active && faculty.approvalStatus === 'approved'
    ? await facultySignature(faculty.id, transaction) || request.facultySignature : null;
  const defaults = {
    moduleTitle: module?.title, skills: module?.skills,
    userId: user.id, courseTitle: attempt.snapshot.title, recipientName: user.name, courseVersion: attempt.courseVersion,
    score, stars: starsFor(score), issuedAt: module ? new Date() : attempt.completedAt || new Date(),
    facultySignature: signature, facultyName: faculty?.name || null,
    facultyPosition: faculty?.facultyPosition || (faculty ? 'Course Faculty' : null),
    badgeLabel: attempt.snapshot.title,
  };
  const [credential, created] = await Credential.findOrCreate({ where: { attemptId: attempt.id, moduleId: module?.id || '' }, defaults, transaction });
  if (created) await Notification.create({ userId: user.id, title: module ? 'Module certificate issued' : 'Course certificate issued', message: `You met the completion rules for ${module?.title || attempt.snapshot.title}. Your certificate and badge are ready.`, href: '/student/achievements' }, { transaction });
  return credential;
}
export async function syncPublishedAttempt(attempt, course, transaction) {
  const update = publishedAttemptSnapshot(attempt, course);
  if (!update) return attempt;
  const snapshot = { ...update.snapshot };
  delete snapshot.finalAssessmentRevision;
  await attempt.update({ ...update, snapshot }, { transaction });
  return attempt;
}
export async function finalizeAttempt(attempt, user, transaction) {
  await attempt.reload({ transaction, lock: transaction.LOCK.UPDATE });
  const score = courseModuleAverage(attempt);
  if (score === null) return false;
  const wasCompleted = attempt.status === 'completed';
  if (!wasCompleted) await attempt.update({ status: 'completed', completedAt: attempt.completedAt || new Date() }, { transaction });
  await ensureCompletionCredential(attempt, user, score, transaction);
  if (!wasCompleted) await Notification.create({ userId: user.id, title: 'Course completed', message: `You passed all module quizzes in ${attempt.snapshot.title}. View your completion history and eligible awards.`, href: '/student/achievements' }, { transaction });
  return !wasCompleted;
}
export const scopeQuestions = (attempt, scope) => scope === 'pretest' ? attempt.snapshot.questions : attempt.snapshot.questions.filter(q => q.moduleId === scope);
export function validateDraftAnswers(questions, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid answers.');
  const answers = {};
  for (const [key, value] of Object.entries(input)) { const q = questions.find(q => q.id === key); if (!q || !/^\d+$/.test(String(value)) || Number(value) >= q.options.length) fail('Invalid answer choice.'); answers[key] = String(value); }
  return answers;
}
export function quizAccess(attempt, scope) {
  if (scope === 'final') return false;
  if (attempt.snapshot.modules.some(m => m.id === scope) && moduleAssessmentResult(attempt, scope)?.score >= attempt.snapshot.passingScore) return false;
  const p = attempt.snapshot.policy || {};
  if (scope === 'pretest') return Boolean(p.pretest && !attempt.quizAttempts.some(a => a.scope === 'pretest'));
  return true;
}
export const assessmentSubmissions = (attempt, scope) => attempt.quizAttempts.filter(result => result.scope === scope);

export async function draftFor(userId, attempt, scope, transaction, startTimer = true) {
  const lastResult = assessmentSubmissions(attempt, scope).findLast(item => !item.expired);
  const [draft] = await QuizDraft.findOrCreate({
    where: { userId, attemptId: attempt.id, scope },
    defaults: { answers: {}, startedAt: startTimer ? new Date() : null, revision: lastResult?.nextDraftRevision ?? 0 },
    transaction
  });
  if (startTimer && !draft.startedAt) {
    await QuizDraft.update({ startedAt: new Date() }, { where: { id: draft.id, startedAt: null }, transaction });
    await draft.reload({ transaction });
  }
  return draft;
}
export function checkQuizLimits(attempt, scope, draft) {
  const p = attempt.snapshot.policy || {}, taken = assessmentSubmissions(attempt, scope).length;
  if (scope !== 'pretest' && p.attemptLimit && taken >= p.attemptLimit) fail('Assessment attempt limit reached. Ask your faculty for a new learning attempt or remediation.', 403);
  if (p.quizMinutes && draft.startedAt && Date.now() - new Date(draft.startedAt) > p.quizMinutes * 60000) fail('Assessment time expired. Your saved answers are retained; restart the assessment to use another permitted attempt.', 409);
}

