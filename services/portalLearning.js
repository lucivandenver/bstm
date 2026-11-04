import { CourseAttempt, Credential, Notification, User } from '../models/learningModels.js';
import { PracticalSubmission, CourseFeedback, QuizDraft, CredentialRequest } from '../models/portalModels.js';
import { Setting } from '../models/adminModels.js';
import { starsFor, canTakeFinal, grade } from './learning.js';
import { fail } from './courseAuthoring.js';
export const tasksFor = a => a.snapshot.tasks || [];
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
  if (attempt.snapshot.certificateEnabled !== false && attempt.snapshot.awardsApproved === true) {
    const request = await CredentialRequest.findOne({ where: { courseId: attempt.courseId, status: 'approved' }, transaction });
    const faculty = request ? await User.findByPk(request.facultyId, { transaction }) : null;
    const settings = await Setting.findAll({ where: { key: ['adminSignature', 'certificateSignatory'] }, transaction }); const values = Object.fromEntries(settings.map(s => [s.key, s.value]));
    await Credential.findOrCreate({ where: { attemptId: attempt.id }, defaults: { userId: user.id, courseTitle: attempt.snapshot.title, recipientName: user.name, courseVersion: attempt.courseVersion, score: weighted, stars: starsFor(weighted), issuedAt: new Date(), facultySignature: request?.facultySignature || null, facultyName: faculty?.name || null, adminSignature: values.adminSignature || null, adminName: values.certificateSignatory || null, badgeLabel: request?.badge?.label || 'Course completion' }, transaction });
  }
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
export async function draftFor(userId, attempt, scope, transaction) {
  const [draft] = await QuizDraft.findOrCreate({ where: { userId, attemptId: attempt.id, scope }, defaults: { answers: {}, startedAt: new Date() }, transaction });
  return draft;
}
export function checkQuizLimits(attempt, scope, draft) {
  const p = attempt.snapshot.policy || {}, taken = attempt.quizAttempts.filter(q => q.scope === scope).length;
  if (scope !== 'pretest' && p.attemptLimit && taken >= p.attemptLimit) fail('Assessment attempt limit reached. Ask your faculty for a new learning attempt or remediation.', 403);
  if (p.quizMinutes && Date.now() - new Date(draft.startedAt) > p.quizMinutes * 60000) fail('Assessment time expired. Your saved answers are retained; restart the assessment to use another permitted attempt.', 409);
}
