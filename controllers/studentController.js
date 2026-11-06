import { createHash } from 'node:crypto';
import { buildEvidence } from '../services/evidence.js';
import QRCode from 'qrcode';
import { Op } from 'sequelize';
import { DiagnosticDraft, CourseAssignment, QuizDraft, PracticalSubmission, CourseFeedback, FacultyNote, ProfileCorrection, StudentFile, CredentialRequest } from '../models/portalModels.js';
import { Section } from '../models/adminModels.js';
import { finalizeAttempt, ensureCompletionCredential, draftFor, scopeQuestions, validateDraftAnswers, checkQuizLimits, quizAccess } from '../services/portalLearning.js';
import { fail as error } from '../services/courseAuthoring.js';
import { CareerPath } from '../models/adminModels.js';
import { setting, genders } from '../services/accounts.js';
import PDFDocument from 'pdfkit';
import { Course, CourseAttempt, StudentProfile, Assessment, Credential, Notification, SavedCourse, sequelize } from '../models/learningModels.js';
import { User } from '../models/userModel.js';
import { text, email as normalizeEmail, profileInput } from '../services/validation.js';
import { baselineQuestions, domains } from '../data/starterCourses.js';
import { progress, moduleAvailable, canTakeQuiz, canTakeFinal, grade, starsFor, publicQuestions, issueChallenge, checkChallenge, careerMatches } from '../services/learning.js';
import { explainCareer, careerLearningContext, careerFingerprint } from '../services/careerAi.js';
import { aiConfiguration } from '../services/gemini.js';
import { appUrl } from '../config/env.js';
const plain = row => row?.get({ plain: true });
const date = value => value ? new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const render = (res, view, data = {}) => res.render(`student/${view}`, { nav: view, ...data });
const fail = (res, message, status = 400) => res.status(status).render('student/message', { title: 'Unable to continue', message });
function localReturnPath(req, fallback) {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const target = new URL(referer, base);
    return target.origin === base ? `${target.pathname}${target.search}` : fallback;
  } catch { return fallback; }
}
const attemptsFor = async userId => (await CourseAttempt.findAll({ where: { userId }, order: [['createdAt', 'DESC']] })).map(plain);
function decorate(attempt) {
  return { ...attempt, title: attempt.snapshot.title, domain: attempt.snapshot.domain, ...progress(attempt),
    started: date(attempt.createdAt), finished: date(attempt.completedAt), completed: attempt.status === 'completed',
    learningMinutes: Math.floor(attempt.activeSeconds / 60), elapsedDays: Math.max(1, Math.ceil((Date.now() - new Date(attempt.createdAt)) / 86400000)) };
}
async function requireProfile(req, res) {
  const profile = await StudentProfile.findOne({ where: { userId: req.user.id } });
  if (!profile?.complete || !req.user.studentId || !req.user.section || !genders.includes(req.user.gender)) {
    req.flash('error_msg', 'Complete your student profile before starting an assessment or course.');
    res.redirect('/student/profile'); return null;
  }
  return profile;
}
export const requireCompleteProfile = async (req, res, next) => {
  if (!await requireProfile(req, res)) return;
  next();
};
export const dashboard = async (req, res) => {
  const [attempts, profile, credentials, baseline, courses] = await Promise.all([
    attemptsFor(req.user.id), StudentProfile.findOne({ where: { userId: req.user.id } }),
    Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] }),
    Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] }),
    Course.findAll({ where: { published: true, ownerId: { [Op.not]: null } }, limit: 4 })
  ]);
  const section = await Section.findOne({ where: {