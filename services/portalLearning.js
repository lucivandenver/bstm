import { facultySignature } from './publicationCredentials.js';
import { Course, CourseAttempt, Credential, Notification, User } from '../models/learningModels.js';
import { PracticalSubmission, CourseFeedback, QuizDraft, CredentialRequest } from '../models/portalModels.js';
import { starsFor, canTakeFinal, grade, publishedAttemptSnapshot } from './learning.js';
import { fail } from './courseAuthoring.js';
export const tasksFor = a => a.snapshot.tasks || [];
export async function ensureCompletionCredential(attempt, user, score = attempt.finalScore, transaction, module = null) {
  if (module && score < attempt.snapshot.passingScore) return null;
  if (!module && attempt.status !== 'completed' || attempt.snapshot.certificateEnabled === false) return null;
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
  if (update.snapshot.finalAssessmentRevision !== (attempt.snapshot.finalAssessmentRevision || 0)) {
    const draft = await QuizDraft.findOne({ where: { attemptId: attempt.id, scope: 'final' }, transaction, lock: transaction.LOCK.UPDATE });
    if (draft) await draft.update({ answers: {}, revision: draft.revision + 1, startedAt: new Date() }, { transaction });
  }
  await attempt.update(update, { transaction });
  return attempt;
}
export async function finalizeAttempt(attempt, user, transaction) {
  if (attempt.status === 'completed' || attempt.finalScore === null || attempt.finalScore < attempt.snapshot.passingScore || !canTakeFinal(attempt)) return false;
  const tasks = tasksFor(attempt).filter(t => t.required !== false);
  const submissions = await PracticalSubmission.findAll({ where: { attemptId: attempt.id }, transaction });
  if (tasks.some(t => !submissions.some(s => s.taskId === t.id && s.status === 'graded' && s.grade >= attempt.snapshot.passingScore))) return false;
  if (attempt.snapshot.policy?.feedbackRequired && !await CourseFeedback.findOne({ where: { attemptId: attempt.id }, transaction })) return false;
  const quizAverage = attempt.snapshot.modules.reduce((sum,m) => sum + (attempt.quizScores[m.id] || 0), 0) / attempt.snapshot.modules.length;
  const p = attempt.snapshot.policy || {};
  const practical = tasks.length ? submissions.filter(s => tasks.some(t => t.id === s.taskId)).reduce((sum,s) => sum + s.grade,0) / tasks.length : 0;
  const weighted = Math.round(quizAverage * (p.quizWeight ?? 0) / 100 + attempt.finalScore * (p.finalWeight ?? 100) / 100 + practical * (p.practicalWeight ?? 0) / 100);
  if (weighted < attempt.snapshot.passingScore) return false;
  await attempt.update({ status: 'completed', completedAt: new Date() }, { transaction });
  await ensureCompletionCredential(attempt, user, weighted, transaction);
  await Notification.create({ userId: user.id, title: 'Course completed', message: `You completed ${attempt.snapshot.title}. View your completion history and eligible awards.`, href: '/student/achievements' }, { transaction });
  return true;
}
export const scopeQuestions = (attempt, scope) => scope === 'final' || scope === 'pretest' ? attempt.snapshot.questions : attempt.snapshot.questions.filter(q => q.moduleId === scope);
export function validateDraftAnswers(questions, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid answers.');
  const answers = {};
  for (const [key, value] of Object.entries(input)) { const q = questions.find(q => q.id === key); if (!q || !/^\d+$/.test(String(value)) || Number(value) >= q.options.length) fail('Invalid answer choice.'); answers[key] = String(value); }
  return answers;
}
export function quizAccess(attempt, scope) {
  const p = attempt.snapshot.policy || {};
  if (scope === 'pretest') return Boolean(p.pretest && !attempt.quizAttempts.some(a => a.scope === 'pretest'));
  if (p.pretest && !attempt.quizAttempts.some(a => a.scope === 'pretest')) return false;
  return true;
}
export const assessmentSubmissions = (attempt, scope) => attempt.quizAttempts.filter(result =>
  result.scope === scope && (scope !== 'final' ||
    (result.finalAssessmentRevision || 0) === (attempt.snapshot.finalAssessmentRevision || 0)));

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

