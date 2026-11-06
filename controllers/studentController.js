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
import { text, profileInput } from '../services/validation.js';
import { baselineQuestions, domains } from '../data/starterCourses.js';
import { progress, moduleAvailable, canTakeQuiz, canTakeFinal, grade, starsFor, publicQuestions, issueChallenge, checkChallenge, careerMatches } from '../services/learning.js';
import { explainCareer, careerLearningContext, careerFingerprint } from '../services/careerAi.js';
import { aiConfiguration } from '../services/gemini.js';
import { googleReady, appUrl } from '../config/env.js';
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
  const section = await Section.findOne({ where: { name: req.user.section } });
  const required = section ? await CourseAssignment.findAll({ where: { sectionId: section.id, required: true } }) : [];
  const requiredCourses = await Course.findAll({ where: { id: { [Op.in]: required.map(r => r.courseId) }, published: true, ownerId: { [Op.not]: null } } });
  const ownerIds = [...new Set([...courses, ...requiredCourses].map(course => course.ownerId).filter(Boolean))];
  const approvedOwners = ownerIds.length ? await User.findAll({ where: { id: { [Op.in]: ownerIds }, role: 'faculty', approvalStatus: 'approved', active: true }, attributes: ['id'] }) : [];
  const approvedOwnerIds = new Set(approvedOwners.map(user => user.id));
  const ongoing = attempts.filter(a => a.status === 'ongoing').map(decorate);
  const completed = attempts.filter(a => a.status === 'completed');
  const evidence = await buildEvidence(attempts, plain(baseline));
  render(res, 'dashboard', { title: 'My dashboard', profileComplete: profile?.complete && req.user.studentId && req.user.section && genders.includes(req.user.gender),
    requiredCourses: requiredCourses.filter(c => approvedOwnerIds.has(c.ownerId)).map(c => ({ ...plain(c), done: attempts.some(a => a.courseId === c.id && a.status === 'completed'), due: date(required.find(r => r.courseId === c.id)?.dueAt) })), ongoing, completedCount: completed.length, credentialCount: credentials.length, activeCount: ongoing.length,
    totalStars: credentials.reduce((sum, c) => sum + c.stars, 0), baseline: plain(baseline),
    domains: domains.map(name => ({ name, score: evidence.scores[name], knowledgeScore: evidence.knowledgeScores[name], practicalScore: evidence.practicalScores[name], hasPractical: evidence.practicalScores[name] !== null, known: evidence.scores[name] !== null })),
    recommended: courses.filter(c => approvedOwnerIds.has(c.ownerId)).map(c => plain(c)),
    recentCredentials: credentials.slice(0, 3).map(c => ({ ...plain(c), date: date(c.issuedAt) })) });
};
export const profilePage = async (req, res) => {
  const profile = plain(await StudentProfile.findOne({ where: { userId: req.user.id } })) || {};
  render(res, 'profile', { title: 'My profile', profile, googleConnected: Boolean(req.user.googleId), googleReady: googleReady(), genders, corrections: (await ProfileCorrection.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })).map(plain), files: (await StudentFile.findAll({ where: { userId: req.user.id }, attributes: ['id', 'filename', 'kind'] })).map(plain) });
};
export const saveProfile = async (req, res) => {
  let data, studentId, section, name;
  try {
    data = profileInput(req.body);
    if (!genders.includes(req.body.gender)) throw new Error('Select your gender.'); studentId = text(req.body.studentId, 40); section = text(req.body.section, 60); name = text(req.body.name, 100);
    if (!/^[\w-]{3,40}$/.test(studentId) || !section || name.length < 2) throw new Error('Enter your full name, Student ID and section.');
  } catch (err) { req.flash('error_msg', err.message); return res.redirect('/student/profile'); }
  try {
    if (studentId !== req.user.studentId || section !== req.user.section) throw Object.assign(new Error('Request an academic record correction below instead of changing your ID or section directly.'), { status: 400 });
    await sequelize.transaction(async transaction => {
      await req.user.update({ name, gender: req.body.gender }, { transaction });
      const [profile] = await StudentProfile.findOrCreate({ where: { userId: req.user.id }, defaults: data, transaction });
      await profile.update(data, { transaction });
    });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    req.flash('error_msg', 'That Student ID is already in use.'); return res.redirect('/student/profile');
  }
  req.flash('success_msg', 'Your profile has been saved.'); res.redirect('/student/profile');
};
export const catalog = async (req, res) => {
  const [courses, attempts, savedRows] = await Promise.all([
    Course.findAll({ where: { published: true, ownerId: { [Op.not]: null } }, order: [['title', 'ASC']] }),
    attemptsFor(req.user.id),
    SavedCourse.findAll({ where: { userId: req.user.id } })
  ]);
  const savedIds = new Set(savedRows.map(row => row.courseId));
  const ownerIds = [...new Set(courses.map(c => c.ownerId).filter(Boolean))];
  const facultyRows = ownerIds.length ? await User.findAll({ where: { id: { [Op.in]: ownerIds }, role: 'faculty', approvalStatus: 'approved', active: true }, attributes: ['id', 'name'] }) : [];
  const facultyById = new Map(facultyRows.map(user => [user.id, user.name]));
  const view = ['saved', 'enrolled'].includes(req.query.view) ? req.query.view : 'all';
  const enrolledIds = new Set(attempts.map(attempt => attempt.courseId));
  const completedIds = new Set(attempts.filter(a => a.status === 'completed').map(a => a.courseId));
  const query = text(req.query.q, 100).toLowerCase(); const domain = text(req.query.domain, 60);
  const author = text(req.query.author, 80);
  const section = await Section.findOne({ where: { name: req.user.section } });
  const assignments = section ? await CourseAssignment.findAll({ where: { sectionId: section.id } }) : [];
  const cards = courses.filter(c => facultyById.has(c.ownerId))
    .filter(c => view !== 'saved' || savedIds.has(c.id))
    .filter(c => view !== 'enrolled' || enrolledIds.has(c.id))
    .filter(c => (!query || `${c.title} ${c.description}`.toLowerCase().includes(query)) && (!domain || (c.competencyAreas || [c.domain]).includes(domain)))
    .filter(c => !author || String(c.ownerId) === author)
    .map(c => {
    const active = attempts.find(a => a.courseId === c.id && a.status === 'ongoing');
    const locked = c.prerequisites.some(id => !completedIds.has(Number(id)));
    return { ...c, author: facultyById.get(c.ownerId), saved: savedIds.has(c.id), required: assignments.some(a => a.courseId === c.id && a.required), due: date(assignments.find(a => a.courseId === c.id)?.dueAt), active, locked, done: completedIds.has(c.id), moduleCount: c.modules.length, lessonCount: c.modules.reduce((sum, m) => sum + m.lessons.length, 0) };
  });
  const visibleCourseIds = new Set(courses.filter(course => facultyById.has(course.ownerId)).map(course => course.id));
  render(res, 'catalog', { title: 'Explore courses', courses: cards, hasRequired: cards.some(course => course.required), domains, query: text(req.query.q, 100), selectedDomain: domain, faculty: facultyRows.map(user => ({ ...plain(user), id: String(user.id) })), selectedAuthor: author, view, savedCount: [...savedIds].filter(id => visibleCourseIds.has(id)).length, enrolledCount: [...enrolledIds].filter(id => visibleCourseIds.has(id)).length });
};
export const saveCourse = async (req, res) => {
  const course = await Course.findOne({ where: { id: req.params.id, published: true, ownerId: { [Op.not]: null } } });
  if (!course) return fail(res, 'Only published faculty courses can be saved.', 404);
  const owner = await User.findOne({ where: { id: course.ownerId, role: 'faculty', approvalStatus: 'approved', active: true } });
  if (!owner) return fail(res, 'This course is not currently available.', 404);
  await SavedCourse.findOrCreate({ where: { userId: req.user.id, courseId: course.id } });
  res.redirect(localReturnPath(req, '/student/courses?view=saved'));
};
export const unsaveCourse = async (req, res) => {
  await SavedCourse.destroy({ where: { userId: req.user.id, courseId: req.params.id } });
  res.redirect(localReturnPath(req, '/student/courses?view=saved'));
};
export const courseDetail = async (req, res) => {
  const courseRow = await Course.findOne({ where: { id: req.params.id, published: true, ownerId: { [Op.not]: null } } });
  const owner = courseRow && await User.findOne({ where: { id: courseRow.ownerId, role: 'faculty', approvalStatus: 'approved', active: true } });
  const course = owner ? plain(courseRow) : null;
  if (!course) return fail(res, 'Course not found.', 404);
  const [attemptRows, savedCourse] = await Promise.all([
    CourseAttempt.findAll({ where: { userId: req.user.id, courseId: course.id }, order: [['attemptNumber', 'DESC']] }),
    SavedCourse.findOne({ where: { userId: req.user.id, courseId: course.id } })
  ]);
  const attempts = attemptRows.map(plain);
  const active = attempts.find(a => a.status === 'ongoing');
  render(res, 'course', { title: course.title, course, active, saved: Boolean(savedCourse), attempts: attempts.map(decorate),
    author: owner.name || 'CareerBridge faculty', prerequisites: (await Course.findAll({ where: { id: { [Op.in]: course.prerequisites } }, attributes: ['id', 'title'] })).map(plain),
    modules: course.modules.map(m => ({ title: m.title, lessons: m.lessons.map(l => ({ title: l.title })) })) });
};
export const enroll = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const course = await Course.findOne({ where: { id: req.params.id, published: true, ownerId: { [Op.not]: null } } });
  if (!course) return fail(res, 'Course not found.', 404);
  if (!await User.findOne({ where: { id: course.ownerId, role: 'faculty', approvalStatus: 'approved', active: true } })) return fail(res, 'This faculty course is not currently available.', 404);
  // Faculty grading follows the course owner. Sections are not assigned to individual faculty.
  const now = Date.now();
  if ((course.enrollFrom && new Date(course.enrollFrom) > now) || (course.enrollUntil && new Date(course.enrollUntil) < now)) return fail(res, 'Enrollment is currently closed for this course.');
  let attempt;
  await sequelize.transaction(async transaction => {
    // Lock the student row to serialize enrollment/retake requests for this user.
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
    const previous = await CourseAttempt.findAll({ where: { userId: req.user.id, courseId: course.id }, order: [['attemptNumber', 'DESC']], transaction });
    attempt = previous.find(a => a.status === 'ongoing');
    if (attempt) return;
    for (const prerequisite of course.prerequisites) {
      if (!await CourseAttempt.findOne({ where: { userId: req.user.id, courseId: Number(prerequisite), status: 'completed' }, transaction })) {
        const error = new Error('Complete the prerequisite courses first.'); error.status = 400; throw error;
      }
    }
    attempt = await CourseAttempt.create({ userId: req.user.id, courseId: course.id, attemptNumber: (previous[0]?.attemptNumber || 0) + 1,
      courseVersion: course.version, snapshot: plain(course), completedLessons: [], quizScores: {}, quizAttempts: [], lastActivityAt: new Date() }, { transaction });
    await Notification.create({ userId: req.user.id, title: 'Your course is ready', message: `You started ${course.title}, attempt ${attempt.attemptNumber}.`, href: `/student/learn/${attempt.id}` }, { transaction });
  });
  res.redirect(`/student/learn/${attempt.id}`);
};
export const myLearning = async (req, res) => {
  const attempts = (await attemptsFor(req.user.id)).map(decorate);
  render(res, 'learning', { title: 'My learning', ongoing: attempts.filter(a => !a.completed).map(a => ({ ...a, resumeHref: resumeHref(a) })), completed: attempts.filter(a => a.completed),
    learningHistory: attempts.flatMap(a => a.quizAttempts.map(result => ({ title: a.title, attemptNumber: a.attemptNumber, scope: result.scope === 'final' ? 'Final assessment' : result.scope === 'pretest' ? 'Course pre-test' : `Module quiz · ${a.snapshot.modules.find(m => m.id === result.scope)?.title || result.scope}`, score: result.score, passed: result.score >= a.snapshot.passingScore, date: date(result.at) }))).slice(0, 30) });
};
function resumeHref(attempt) {
  if (attempt.status === 'completed') return `/student/learn/${attempt.id}`;
  if (attempt.snapshot.policy?.pretest && !attempt.quizAttempts.some(q => q.scope === 'pretest')) return `/student/learn/${attempt.id}/quiz/pretest`;
  for (const module of attempt.snapshot.modules) {
    const available = moduleAvailable(attempt, attempt.snapshot.modules.indexOf(module));
    if (!available) continue;
    const unfinished = module.lessons.find(lesson => !attempt.completedLessons.includes(lesson.id));
    if (unfinished) return `/student/learn/${attempt.id}?lesson=${encodeURIComponent(attempt.lastLessonId && !attempt.completedLessons.includes(attempt.lastLessonId) ? attempt.lastLessonId : unfinished.id)}`;
    if (!(attempt.quizScores[module.id] >= attempt.snapshot.passingScore)) return `/student/learn/${attempt.id}/quiz/${module.id}`;
  }
  if (canTakeFinal(attempt)) return `/student/learn/${attempt.id}/final`;
  return `/student/learn/${attempt.id}`;
}
async function ownedAttempt(req, transaction) {
  return CourseAttempt.findOne({ where: { id: req.params.id, userId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) });
}
export const learn = async (req, res) => {
  const row = await ownedAttempt(req); if (!row) return fail(res, 'Learning attempt not found.', 404);
  const attempt = plain(row); const course = attempt.snapshot;
  const modules = course.modules.map((m, i) => ({ ...m, available: moduleAvailable(attempt, i),
    passed: attempt.quizScores[m.id] >= course.passingScore, score: attempt.quizScores[m.id],
    quizAvailable: canTakeQuiz(attempt, m.id), lessons: m.lessons.map(l => ({ ...l, completed: attempt.completedLessons.includes(l.id) })) }));
  let selected;
  if (req.query.lesson) {
    for (const m of modules) {
      const lesson = m.lessons.find(l => l.id === req.query.lesson);
      if (lesson && m.available) selected = { ...lesson, moduleTitle: m.title };
    }
    if (!selected) return fail(res, 'This lesson is locked or unavailable.', 403);
  } else {
    const savedLesson = modules.find(m => m.available)?.lessons.find(l => l.id === attempt.lastLessonId && !l.completed);
    const m = savedLesson ? modules.find(m => m.lessons.some(l => l.id === savedLesson.id)) : modules.find(m => m.available && m.lessons.some(l => !l.completed)) || modules[0];
    selected = { ...(savedLesson || m.lessons.find(l => !l.completed) || m.lessons[0]), moduleTitle: m.title };
  }
  if (selected?.id && attempt.status !== 'completed' && attempt.lastLessonId !== selected.id) await row.update({ lastLessonId: selected.id, lastActivityAt: new Date() });
  const submissions = await PracticalSubmission.findAll({ where: { attemptId: attempt.id } });
  render(res, 'learn', { tasks: (course.tasks || []).map(t => ({ ...t, submission: plain(submissions.find(s => s.taskId === t.id)) })), hasTasks: Boolean(course.tasks?.length), feedbackRequired: course.policy?.feedbackRequired, pretestNeeded: course.policy?.pretest && !attempt.quizAttempts.some(a => a.scope === 'pretest'), title: course.title, attempt: decorate(attempt), modules, selected, finalAvailable: canTakeFinal(attempt), completed: attempt.status === 'completed' });
};
export const completeLesson = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    if (!attempt) { const err = new Error('Attempt not found.'); err.status = 404; throw err; }
    if (attempt.status === 'completed') return;
    if (attempt.snapshot.policy?.pretest && !attempt.quizAttempts.some(q => q.scope === 'pretest')) error('Complete the course pre-test first.',403);
    const index = attempt.snapshot.modules.findIndex(m => m.lessons.some(l => l.id === req.body.lessonId));
    if (index < 0 || !moduleAvailable(attempt, index)) { const err = new Error('Lesson is locked.'); err.status = 403; throw err; }
    await attempt.update({ completedLessons: [...new Set([...attempt.completedLessons, req.body.lessonId])], lastActivityAt: new Date() }, { transaction });
  });
  res.redirect(`/student/learn/${req.params.id}`);
};
export const heartbeat = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    if (!attempt || attempt.status === 'completed') return;
    const now = Date.now();
    const delta = attempt.lastHeartbeatAt ? Math.floor((now - new Date(attempt.lastHeartbeatAt).getTime()) / 1000) : 0;
    await attempt.update({ activeSeconds: attempt.activeSeconds + (delta > 0 && delta <= 45 ? delta : 0), lastHeartbeatAt: new Date(now), lastActivityAt: new Date(now) }, { transaction });
  });
  res.json({ saved: true });
};
function scopeAllowed(a, scope) {
  return quizAccess(a, scope) && (scope === 'pretest' || (scope === 'final' ? canTakeFinal(a) : canTakeQuiz(a, scope)));
}
export const quizPage = async (req, res) => {
  const attempt = plain(await ownedAttempt(req)); if (!attempt) return fail(res, 'Attempt not found.', 404);
  if (attempt.status === 'completed') return res.redirect(`/student/learn/${attempt.id}`);
  const scope = req.params.moduleId || 'final', final = scope === 'final';
  if (!scopeAllowed(attempt, scope)) return fail(res, 'Complete the required pre-test, lessons and quizzes first.', 403);
  const draft = await draftFor(req.user.id, attempt, scope);
  let questions = scopeQuestions(attempt, scope);
  if (attempt.snapshot.policy?.randomize) { const rank = q => createHash('sha256').update(`${attempt.id}:${scope}:${attempt.quizAttempts.length}:${q.id}`).digest('hex'); questions = [...questions].sort((a,b) => rank(a).localeCompare(rank(b))); }
  const timed = Boolean(attempt.snapshot.policy?.quizMinutes), remaining = timed ? Math.max(0, Math.floor((new Date(draft.startedAt).getTime() + attempt.snapshot.policy.quizMinutes * 60000 - Date.now()) / 1000)) : null;
  const limited = scope !== 'pretest' && attempt.snapshot.policy?.attemptLimit && attempt.quizAttempts.filter(q => q.scope === scope).length >= attempt.snapshot.policy.attemptLimit;
  render(res, 'quiz', { timed, blocked: limited || timed && remaining === 0, blockedReason: limited ? 'Assessment submission limit reached. Review the lessons and contact your faculty for remediation.' : 'Time expired. Your saved answers remain visible; use the restart action below if you have attempts remaining.', title: scope === 'pretest' ? 'Course pre-test' : final ? 'Final assessment' : 'Module quiz', questions: publicQuestions(questions).map(q => ({ ...q, options: q.options.map((label, index) => ({ label, index, checked: String(draft.answers[q.id]) === String(index) })) })), attempt, scope, final, pretest: scope === 'pretest', draftRevision: draft.revision, draftUrl: `/student/learn/${attempt.id}/draft/${scope}`, remainingSeconds: attempt.snapshot.policy?.quizMinutes ? Math.max(0, Math.floor((new Date(draft.startedAt).getTime() + attempt.snapshot.policy.quizMinutes * 60000 - Date.now()) / 1000)) : null, challenge: issueChallenge(req.user.id, `${attempt.id}:${scope}`) });
};
export const saveDraft = async (req, res) => {
  let saved;
  await sequelize.transaction(async transaction => {
    const a = await ownedAttempt(req, transaction); if (!a || a.status === 'completed') error('Attempt unavailable.', 404);
    const scope = req.params.scope; if (!scopeAllowed(a, scope)) error('Assessment locked.', 403);
    const draft = await draftFor(req.user.id, a, scope, transaction); checkQuizLimits(a, scope, draft);
    if (Number(req.body.revision) !== draft.revision) error('Answers changed in another tab. Reload before continuing.', 409);
    const answers = validateDraftAnswers(scopeQuestions(a, scope), req.body.answers);
    await draft.update({ answers, revision: draft.revision + 1 }, { transaction }); saved = { saved: true, revision: draft.revision };
  }); res.json(saved);
};
export const restartQuiz = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const a = await ownedAttempt(req, transaction), scope = req.params.scope; if (!a || a.status === 'completed' || !scopeAllowed(a, scope)) error('Assessment unavailable.', 403);
    const d = await draftFor(req.user.id, a, scope, transaction), p = a.snapshot.policy || {};
    if (!p.quizMinutes || Date.now() - new Date(d.startedAt) <= p.quizMinutes * 60000) error('Only an expired timed assessment can be restarted.');
    const history = [...a.quizAttempts, { scope, score: 0, expired: true, seconds: p.quizMinutes * 60, at: new Date().toISOString() }];
    if (p.attemptLimit && history.filter(q => q.scope === scope).length >= p.attemptLimit) error('Attempt limit reached. Contact your faculty.', 403);
    await a.update({ quizAttempts: history }, { transaction }); await d.update({ startedAt: new Date(), answers: {}, revision: d.revision + 1 }, { transaction });
  }); res.redirect(`/student/learn/${req.params.id}/${req.params.scope === 'final' ? 'final' : 'quiz/' + req.params.scope}`);
};
export const submitQuiz = async (req, res) => {
  const scope = req.params.moduleId || 'final', final = scope === 'final', pretest = scope === 'pretest';
  const nonce = checkChallenge(req.body.challenge, req.user.id, `${req.params.id}:${scope}`);
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction); if (!attempt) error('Attempt not found.', 404);
    if (attempt.status === 'completed' || attempt.quizAttempts.some(a => a.nonce === nonce)) return;
    if (!scopeAllowed(attempt, scope)) error('Requirements are incomplete.', 403);
    const draft = await draftFor(req.user.id, attempt, scope, transaction); checkQuizLimits(attempt, scope, draft);
    const result = grade(scopeQuestions(attempt, scope), req.body.answers || {}), passed = result.score >= attempt.snapshot.passingScore;
    const update = { quizAttempts: [...attempt.quizAttempts, { nonce, scope, score: result.score, seconds: Math.max(0, Math.floor((Date.now() - new Date(draft.startedAt)) / 1000)), at: new Date().toISOString() }], lastActivityAt: new Date() };
    if (final) update.finalScore = result.score;
    else if (!pretest) update.quizScores = { ...attempt.quizScores, [scope]: Math.max(attempt.quizScores[scope] || 0, result.score) };
    await attempt.update(update, { transaction });
    await draft.update({ answers: {}, startedAt: new Date(), revision: draft.revision + 1 }, { transaction });
    const completed = final && passed ? await finalizeAttempt(attempt, req.user, transaction) : false;
    req.flash(passed || pretest ? 'success_msg' : 'error_msg', `${pretest ? 'Pre-test' : final ? 'Final assessment' : 'Module quiz'}: ${result.score}%. ${pretest ? 'Starting knowledge recorded. Continue with the lessons.' : completed ? 'Course completed! View your achievements.' : passed ? final ? 'Passed. Complete any practical tasks and required feedback to finish the course.' : 'Passed. The next module is available.' : 'Review the lessons, then try again.'}`);
  }); delete req.session.careerAi; res.redirect(`/student/learn/${req.params.id}`);
};
export const assessmentPage = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const history = await Assessment.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const [draft] = await DiagnosticDraft.findOrCreate({ where: { userId: req.user.id }, defaults: { answers: {} } });
  render(res, 'assessment', { draftRevision: draft.revision, title: 'Knowledge diagnostic', questions: publicQuestions(baselineQuestions).map(q => ({ ...q, choices: q.options.map((label,index) => ({ label, index, checked: String(draft.answers[q.id]) === String(index) })) })),
    challenge: issueChallenge(req.user.id, 'baseline'), history: history.map(a => ({ ...plain(a), date: date(a.createdAt) })) });
};
export const submitAssessment = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const nonce = checkChallenge(req.body.challenge, req.user.id, 'baseline');
  const result = grade(baselineQuestions, req.body.answers || {});
  await sequelize.transaction(async transaction => {
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
    // nonce recorded with answers to prevent double-clicks / replay creating duplicate results.
    const previous = await Assessment.findAll({ where: { userId: req.user.id }, transaction });
    if (previous.some(a => a.answers?.nonce === nonce)) return;
    await Assessment.create({ userId: req.user.id, score: result.score, scores: result.scores, answers: { values: result.answers, nonce }, version: 1 }, { transaction });
    const draft = await DiagnosticDraft.findOne({ where: { userId: req.user.id }, transaction }); if (draft) await draft.update({ answers: {}, revision: draft.revision + 1 }, { transaction });
  });
  delete req.session.careerAi;
  req.flash('success_msg', 'Knowledge diagnostic saved. Review your results and recommended learning areas.');
  res.redirect('/student/results');
};
export const results = async (req, res) => {
  const attempts = await attemptsFor(req.user.id);
  const assessments = await Assessment.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const evidence = await buildEvidence(attempts, plain(assessments[0]));
  render(res, 'results', { feedback: (await FacultyNote.findAll({ where: { studentId: req.user.id, visibility: 'student' }, order: [['createdAt', 'DESC']] })).map(n => ({ ...plain(n), date: date(n.createdAt) })), title: 'My results & skills gaps', domains: domains.map(name => ({ name, score: evidence.scores[name], knowledgeScore: evidence.knowledgeScores[name], practicalScore: evidence.practicalScores[name], hasPractical: evidence.practicalScores[name] !== null, known: evidence.scores[name] !== null, gap: evidence.scores[name] === null || evidence.scores[name] < 75 })),
    attempts: attempts.map(decorate), assessments: assessments.map(a => ({ ...plain(a), date: date(a.createdAt) })) });
};
export const careers = async (req, res) => {
  const [attempts, baseline, profile, courses] = await Promise.all([
    attemptsFor(req.user.id), Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] }),
    StudentProfile.findOne({ where: { userId: req.user.id } }), Course.findAll({ where: { published: true, ownerId: { [Op.not]: null } } })
  ]);
  const facultyIds = [...new Set(courses.map(course => course.ownerId).filter(Boolean))];
  const approvedFaculty = facultyIds.length ? await User.findAll({ where: { id: { [Op.in]: facultyIds }, role: 'faculty', approvalStatus: 'approved', active: true }, attributes: ['id'] }) : [];
  const visibleIds = new Set(approvedFaculty.map(user => user.id));
  const eligibleCourses = courses.filter(course => visibleIds.has(course.ownerId));
  const evidence = await buildEvidence(attempts, plain(baseline), profile?.careerInterest, (await CareerPath.findAll({ where: { active: true } })).map(p => p.get({ plain: true })));
  const learningContext = careerLearningContext(attempts, (await Credential.findAll({where:{userId:req.user.id,revoked:false}})).map(plain));
  const fingerprint = careerFingerprint(evidence, learningContext);
  if (req.session.careerAi && req.session.careerAi.fingerprint !== fingerprint) delete req.session.careerAi;
  const completedIds = new Set(attempts.filter(a => a.status === 'completed').map(a => a.courseId));
  const recommendations = eligibleCourses.filter(c => evidence.scores[c.domain] === null || evidence.scores[c.domain] < 75).map(c => ({ ...plain(c), locked: c.prerequisites.some(id => !completedIds.has(Number(id))) }));
  const tracks = evidence.tracks.map(track => ({ ...track, relatedCourses: eligibleCourses.filter(course => (course.competencyAreas || [course.domain]).some(area=>track.required.includes(area))).map(course => ({ ...plain(course), learningStatus: completedIds.has(course.id) ? 'Completed' : attempts.some(a => a.courseId === course.id && a.status === 'ongoing') ? 'In progress' : 'Available', done: completedIds.has(course.id), active: attempts.some(a => a.courseId === course.id && a.status === 'ongoing') })) }));
  render(res, 'careers', { evidenceDate: date(new Date()), evidenceSources: attempts.filter(a => a.status === 'completed').map(a => ({ title: a.snapshot.title, version: a.courseVersion, date: date(a.completedAt), score: a.finalScore })), hasBaseline: Boolean(baseline), title: 'Find My Career', tracks, recommendations,
    developingCourses:learningContext.developing, aiReady: aiConfiguration().ready, ai: req.session.careerAi || null });
};
export const generateGuidance = async (req, res) => {
  const json=req.get('accept')?.includes('application/json');
  const reject=(message,status=400)=>{if(json)return res.status(status).json({ok:false,message});req.flash('error_msg',message);return res.redirect('/student/careers');};
  if(req.body.consent!=='yes')return reject('Confirm permission to send your anonymised learning evidence to Gemini.');
  const attempts=await attemptsFor(req.user.id),baseline=await Assessment.findOne({where:{userId:req.user.id},order:[['createdAt','DESC']]});
  if(!baseline&&!attempts.some(a=>a.status==='completed'||a.completedLessons?.length||Object.keys(a.quizScores||{}).length))return reject('Start learning and save some course progress, or complete an assessment, before finding career directions.');
  try{
    const evidence=await buildEvidence(attempts,plain(baseline),'',(await CareerPath.findAll({where:{active:true}})).map(plain));
    if(!evidence.tracks.length)return reject('No career pathways are configured yet. Ask Admin to add the pathway rules.');
    const learning=careerLearningContext(attempts,(await Credential.findAll({where:{userId:req.user.id,revoked:false}})).map(plain));
    const ai=await explainCareer(evidence,learning);
    if(!ai)return reject('AI is not configured. Ask Admin to configure the provider.',503);
    req.session.careerAi={...ai,generatedAt:date(new Date()),fingerprint:careerFingerprint(evidence,learning)};
    req.flash('success_msg','Career recommendations generated from your learning evidence.');
    if(json)return res.json({ok:true,redirect:'/student/careers#ai-results'});
    res.redirect('/student/careers#ai-results');
  }catch(error){return reject(error.code?error.message:'AI guidance is temporarily unavailable. Your previous results and rule-based pathways remain available.',error.status||503);}
};
export const achievements = async (req, res) => {
  const allAttempts = await attemptsFor(req.user.id);
  const completed = allAttempts.filter(a => a.status === 'completed').sort((a,b) => new Date(a.completedAt) - new Date(b.completedAt));
  const existing = await Credential.findAll({ where: { userId: req.user.id }, attributes: ['attemptId'] });
  const issuedAttempts = new Set(existing.map(row => Number(row.attemptId)));
  for (const attempt of completed) if (attempt.snapshot.certificateEnabled !== false && !issuedAttempts.has(Number(attempt.id))) await ensureCompletionCredential(attempt, req.user);
  const rows = await Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] });
  const groups = [...new Set(completed.map(a => a.courseId))].map(courseId => { const all = completed.filter(a => a.courseId === courseId); return { title: all.at(-1).snapshot.title, first: date(all[0].completedAt), latest: date(all.at(-1).completedAt), completions: all.length, repeats: Math.max(0,all.length - 1), best: Math.max(...all.map(a => a.finalScore)), latestScore: all.at(-1).finalScore }; });
  const pendingAwards = completed.filter(attempt => attempt.snapshot.certificateEnabled !== false && !rows.some(row => row.attemptId === attempt.id)).map(attempt => ({ title: attempt.snapshot.title, date: date(attempt.completedAt) }));
  render(res, 'achievements', { pendingAwards, completionHistory: groups, title: 'My achievements', credentials: rows.map(c => ({ ...plain(c), date: date(c.issuedAt), starsText: '★'.repeat(c.stars) })) });
};
async function ownedCredential(req) {
  return Credential.findOne({ where: { id: req.params.id, userId: req.user.id, revoked: false } });
}
export const certificate = async (req, res) => {
  const c = await ownedCredential(req); if (!c) return fail(res, 'Certificate not found.', 404);
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `attachment; filename="CareerBridge-${c.id}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 25 });
  doc.on('error', () => res.end()); doc.pipe(res);
    const request = await CredentialRequest.findOne({ where: { courseId: (await CourseAttempt.findByPk(c.attemptId))?.courseId, status: 'approved' } });
    const modern = false;
  doc.rect(25, 25, 792, 545).lineWidth(2).stroke(modern ? '#182c3d' : '#007042');
  if (modern) doc.rect(25,25,792,68).fill('#182c3d');
  doc.fillColor(modern ? '#ffffff' : '#007042').fontSize(17).text('BSTM CAREERBRIDGE',55,43,{width:730,align:'center'});
  doc.fontSize(9).text(await setting('institutionName','MinSU Bongabong Campus'),55,68,{width:730,height:22,align:'center'});
  doc.fillColor('#172533').fontSize(29).text('Certificate of Completion',55,112,{width:730,align:'center'});
  doc.fontSize(12).text('This certifies that',55,168,{width:730,align:'center'});
  const fitted = (value,y,size,min,height) => { while(size>min && doc.widthOfString(value,{fontSize:size})>690)size--;let fittedValue=String(value);while(fittedValue.length>1&&doc.widthOfString(fittedValue,{fontSize:size})>690)fittedValue=fittedValue.slice(0,-2)+'…';doc.fontSize(size).text(fittedValue,75,y,{width:690,height,align:'center',lineBreak:false}); };
  fitted(c.recipientName,198,26,16,65);
  doc.fontSize(12).text('successfully completed the learning requirements for',55,280,{width:730,align:'center'});
  fitted(c.courseTitle,314,23,15,66);
  doc.fontSize(11).text(`Version ${c.courseVersion}  |  Award grade: ${c.score}%  |  Issued: ${date(c.issuedAt)}`,55,402,{width:730,align:'center'});
  doc.fontSize(9).text(await setting('certificateFooter','Platform course completion record. Not a professional licence.'),75,431,{width:690,height:30,align:'center'});
  const url = `${appUrl}/verify/${c.id}`;
  doc.fillColor('#007042').fontSize(8).text(`Verify: ${url}`,75,477,{width:610,align:'center',link:url});
  doc.fillColor('#64748b').fontSize(8).text(`Credential ID: ${c.id}`,75,499,{width:610,align:'center'});
    const systemIssued = c.adminName === 'CareerBridge Learning System';
    const signatory = c.adminName || await setting('certificateSignatory',''), adminPosition = c.adminPosition || (systemIssued ? 'System-issued completion record' : await setting('certificateSignatoryPosition','Administrator')), adminSignature = c.adminSignature || (systemIssued ? '' : await setting('adminSignature','')), facultySignature = c.facultySignature || request?.facultySignature || '', facultyAccount = request ? await User.findByPk(request.facultyId) : null, facultyName = c.facultyName || facultyAccount?.name || '', facultyPosition = c.facultyPosition || facultyAccount?.facultyPosition || 'Course Faculty';
    if (facultySignature) { const raw = Buffer.from(facultySignature.split(',')[1], 'base64'); doc.image(raw,175,455,{fit:[150,54],align:'center'}); }
    if (adminSignature) { const raw = Buffer.from(adminSignature.split(',')[1], 'base64'); doc.image(raw,535,455,{fit:[150,54],align:'center'}); }
    if (facultyName) doc.fillColor('#172533').fontSize(9).text(facultyName,175,510,{width:150,height:18,align:'center'});
    if (signatory) doc.fillColor('#172533').fontSize(9).text(signatory,535,510,{width:150,height:18,align:'center'});
    if (facultyName || facultySignature) doc.fillColor('#64748b').fontSize(8).text(facultyPosition,175,530,{width:150,height:20,align:'center'});
    doc.text(adminPosition,535,530,{width:150,height:20,align:'center'});
  const qr = await QRCode.toBuffer(url,{width:90,margin:1});doc.image(qr,728,478,{width:66});doc.end();
};
export const badge = async (req, res) => {
  const c = await ownedCredential(req); if (!c) return fail(res, 'Badge not found.', 404);
  const label = String(c.badgeLabel || 'Course completion').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[ch]);
  res.set('Content-Type', 'image/svg+xml'); res.set('Content-Disposition', `attachment; filename="CareerBridge-badge-${c.id}.svg"`);
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="440" viewBox="0 0 400 440"><rect width="400" height="440" rx="24" fill="#f3faf6"/><path d="M200 35 345 105v140L200 365 55 245V105Z" fill="#007042"/><circle cx="200" cy="180" r="78" fill="#fff"/><path d="m152 180 32 32 65-65" fill="none" stroke="#007042" stroke-width="18"/><g fill="white" text-anchor="middle" font-family="Arial"><text x="200" y="290" font-size="19">${label}</text><text x="200" y="322" font-size="20">${'★'.repeat(c.stars)}</text></g><text x="200" y="405" text-anchor="middle" font-family="Arial" fill="#007042" font-size="20">BSTM CAREERBRIDGE</text></svg>`);
};
export const verify = async (req, res) => {
  const c = await Credential.findByPk(req.params.id);
  if (!c) return res.status(404).render('verify', { title: 'Credential not found', missing: true });
  res.render('verify', { title: 'Verify credential', credential: { ...plain(c), date: date(c.issuedAt) } });
};
export const downloadReport = async (req, res) => {
  const attempts = await attemptsFor(req.user.id);
  const baseline = await Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const evidence = await buildEvidence(attempts, plain(baseline));
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', 'attachment; filename="CareerBridge-learning-report.pdf"');
  const doc = new PDFDocument({ margin: 50 }); doc.on('error', () => res.end()); doc.pipe(res);
  doc.fontSize(21).fillColor('#007042').text('CareerBridge Learning Report');
  doc.moveDown().fontSize(12).fillColor('#172533').text(req.user.name).text(`Generated: ${date(new Date())}`);
  doc.moveDown().fontSize(15).text('Knowledge evidence');
  for (const domain of domains) doc.fontSize(11).text(`${domain}: ${evidence.scores[domain] === null ? 'Not assessed' : evidence.scores[domain] + '%'}`);
  doc.moveDown().fontSize(15).text('Course attempts');
  if (!attempts.length) doc.fontSize(11).text('No courses started.');
  for (const a of attempts) doc.fontSize(11).text(`${a.snapshot.title} - Attempt ${a.attemptNumber}: ${a.status}; final score ${a.finalScore ?? 'not assessed'}`);
  doc.moveDown().fontSize(15).text('Exploratory career pathways');
  for (const track of evidence.tracks) doc.fontSize(11).text(`${track.title}: ${track.label}`);
  doc.moveDown().fontSize(10).fillColor('#64748b').text('Scores measure available knowledge evidence. Practical performance, qualifications and employer requirements need separate evaluation. Starter content is not yet a validated readiness instrument.'); doc.end();
};

export const notifications = async (req, res) => {
  const rows = await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 100 });
  render(res, 'notifications', { title: 'Notifications', notifications: rows.map(row => ({ ...plain(row), date: date(row.createdAt), unread: !row.readAt })) });
};
export const readNotifications = async (req, res) => {
  await Notification.update({ readAt: new Date() }, { where: { userId: req.user.id, readAt: null } });
  res.redirect('/student/notifications');
};

export const activities = async (req, res) => {
  const attempt = await ownedAttempt(req); if (!attempt) return fail(res, 'Attempt not found.', 404);
  const submissions = await PracticalSubmission.findAll({ where: { attemptId: attempt.id } });
  render(res, 'activities', { title: 'Practical activities & course feedback', attempt: decorate(plain(attempt)), tasks: (attempt.snapshot.tasks || []).map(t => { const sub = submissions.find(s => s.taskId === t.id); return { ...t, submission: plain(sub), rubric: t.rubric.map(r => ({ ...r, score: sub?.scores[r.id] ?? '—' })), canSubmit: attempt.status !== 'completed' && (!sub || sub.status === 'graded' && sub.grade < attempt.snapshot.passingScore) }; }), feedback: plain(await CourseFeedback.findOne({ where: { attemptId: attempt.id } })), completed: attempt.status === 'completed' });
};
export const submitTask = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const a = await ownedAttempt(req, transaction); if (!a || a.status === 'completed') error('Attempt unavailable.', 403);
    const task = a.snapshot.tasks?.find(t => t.id === req.params.taskId); if (!task || !canTakeFinal(a)) error('Complete the module quizzes before submitting a practical task.', 403);
    const response = text(req.body.response, 12000), link = text(req.body.link, 1000);
    if (response.length < 30 || link && !/^https:\/\/[^\s]+$/i.test(link)) error('Enter a response of at least 30 characters and an optional HTTPS evidence link.');
    const [sub] = await PracticalSubmission.findOrCreate({ where: { attemptId: a.id, taskId: task.id }, defaults: { userId: req.user.id, response, link }, transaction });
    if (sub.status === 'graded' && sub.grade >= a.snapshot.passingScore) error('Passed task submissions are locked.');
    await sub.update({ response, link, status: 'submitted', scores: {}, grade: null, feedback: null }, { transaction });
    const course = await Course.findByPk(a.courseId, { transaction });
    if (course?.ownerId) await Notification.create({ userId: course.ownerId, title: 'Practical task awaiting grading', message: `${req.user.name} submitted ${task.title}.`, href: '/faculty/evaluations' }, { transaction });
  }); req.flash('success_msg', 'Task submitted for faculty evaluation.'); res.redirect(`/student/learn/${req.params.id}/activities`);
};
export const submitFeedback = async (req, res) => {
  const rating = Number(req.body.rating), comment = text(req.body.comment, 1500); if (!Number.isInteger(rating) || rating < 1 || rating > 5) error('Choose a course rating from 1 to 5.');
  await sequelize.transaction(async transaction => { const a = await ownedAttempt(req, transaction); if (!a || !canTakeFinal(a) || a.finalScore === null || a.finalScore < a.snapshot.passingScore) error('Pass the final assessment before providing course feedback.');
    const [feedback] = await CourseFeedback.findOrCreate({ where: { attemptId: a.id }, defaults: { userId: req.user.id, rating, comment }, transaction }); await feedback.update({ rating, comment }, { transaction });
    await a.update({ quizScores: { ...a.quizScores, feedback: 100 } }, { transaction }); await finalizeAttempt(a, req.user, transaction);
  }); res.redirect(`/student/learn/${req.params.id}/activities`);
};
export const correction = async (req, res) => {
  const studentId = text(req.body.studentId, 40), section = text(req.body.section, 60), reason = text(req.body.reason, 1000);
  if (!/^[\w-]{3,40}$/.test(studentId) || reason.length < 10 || !await Section.findOne({ where: { name: section, active: true } })) error('Enter a valid ID, active section and correction reason.');
  if (await ProfileCorrection.findOne({ where: { userId: req.user.id, status: 'pending' } })) error('You already have a pending correction request.');
  await ProfileCorrection.create({ userId: req.user.id, studentId, section, reason });
  const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] });
  await Notification.bulkCreate(admins.map(admin => ({ userId: admin.id, title: 'Academic correction requested', message: `${req.user.name} requested an academic record correction.`, href: '/admin/academic' })));
  req.flash('success_msg', 'Correction request sent to Admin. Current records remain until approved.'); res.redirect('/student/profile');
};
export const uploadProfileFile = async (req, res) => {
  const file = req.file, kind = req.body.kind === 'photo' ? 'photo' : 'qualification';
  if (!file || file.size > 2 * 1024 * 1024) error('Upload an image or PDF up to 2 MB.');
  const bytes = file.buffer; const mime = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0,5).toString() === '%PDF-' ? 'application/pdf' : null;
  if (!mime || kind === 'photo' && !mime.startsWith('image/')) error('Use PNG/JPEG for photos, or PNG/JPEG/PDF for qualification evidence.');
  if (await StudentFile.count({ where: { userId: req.user.id } }) >= 10) error('Maximum of 10 supporting files reached. Contact Admin for records maintenance.');
  await StudentFile.create({ userId: req.user.id, kind, filename: text(file.originalname, 180), mime, data: bytes }); req.flash('success_msg', 'File saved privately. Uploaded qualifications remain self-declared until verified.'); res.redirect('/student/profile');
};

export const saveDiagnosticDraft = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  let revision;
  await sequelize.transaction(async transaction => {
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
    const [draft] = await DiagnosticDraft.findOrCreate({ where: { userId: req.user.id }, defaults: { answers: {} }, transaction });
    if (Number(req.body.revision) !== draft.revision) error('Diagnostic changed in another tab. Reload to continue.',409);
    await draft.update({ answers: validateDraftAnswers(baselineQuestions, req.body.answers), revision: draft.revision + 1 }, { transaction }); revision = draft.revision;
  }); res.json({ saved:true, revision });
};
export const reviewAnswers = async (req,res) => {
  const a = await ownedAttempt(req), scope = req.params.scope;
  if (!a || !a.quizAttempts.some(q => q.scope === scope)) return fail(res, 'Submit this assessment before reviewing its answers.',403);
  if (a.snapshot.policy?.feedbackTiming === 'after-completion' && a.status !== 'completed') return fail(res,'Answer explanations are released after course completion.',403);
  render(res,'review',{ title:'Assessment feedback', attempt: decorate(plain(a)), questions: scopeQuestions(a,scope).map(q => ({ prompt:q.prompt, answer:q.options[q.answer], explanation:q.explanation, sourceReference:q.sourceReference })) });
};

