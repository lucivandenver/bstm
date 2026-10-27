import PDFDocument from 'pdfkit';
import { Course, CourseAttempt, StudentProfile, Assessment, Credential, Notification, sequelize } from '../models/learningModels.js';
import { User } from '../models/userModel.js';
import { text, profileInput } from '../services/validation.js';
import { baselineQuestions, domains } from '../data/starterCourses.js';
import { progress, moduleAvailable, canTakeQuiz, canTakeFinal, grade, starsFor, publicQuestions, issueChallenge, checkChallenge, careerMatches } from '../services/learning.js';
import { explainCareer } from '../services/careerAi.js';
import { googleReady, appUrl } from '../config/env.js';
const plain = row => row?.get({ plain: true });
const date = value => value ? new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const render = (res, view, data = {}) => res.render(`student/${view}`, { nav: view, ...data });
const fail = (res, message, status = 400) => res.status(status).render('student/message', { title: 'Unable to continue', message });
const attemptsFor = async userId => (await CourseAttempt.findAll({ where: { userId }, order: [['createdAt', 'DESC']] })).map(plain);
function decorate(attempt) {
  return { ...attempt, title: attempt.snapshot.title, domain: attempt.snapshot.domain, ...progress(attempt),
    started: date(attempt.createdAt), finished: date(attempt.completedAt), completed: attempt.status === 'completed',
    learningMinutes: Math.floor(attempt.activeSeconds / 60), elapsedDays: Math.max(1, Math.ceil((Date.now() - new Date(attempt.createdAt)) / 86400000)) };
}
async function requireProfile(req, res) {
  const profile = await StudentProfile.findOne({ where: { userId: req.user.id } });
  if (!profile?.complete || !req.user.studentId || !req.user.section) {
    req.flash('error_msg', 'Complete your student profile before starting an assessment or course.');
    res.redirect('/student/profile'); return null;
  }
  return profile;
}
export const dashboard = async (req, res) => {
  const [attempts, profile, credentials, baseline, courses] = await Promise.all([
    attemptsFor(req.user.id), StudentProfile.findOne({ where: { userId: req.user.id } }),
    Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] }),
    Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] }),
    Course.findAll({ where: { published: true }, limit: 4 })
  ]);
  const ongoing = attempts.filter(a => a.status === 'ongoing').map(decorate);
  const completed = attempts.filter(a => a.status === 'completed');
  const evidence = careerMatches(attempts, plain(baseline));
  render(res, 'dashboard', { title: 'My dashboard', profileComplete: profile?.complete && req.user.studentId && req.user.section,
    ongoing, completedCount: completed.length, credentialCount: credentials.length, activeCount: ongoing.length,
    totalStars: credentials.reduce((sum, c) => sum + c.stars, 0), baseline: plain(baseline),
    domains: domains.map(name => ({ name, score: evidence.scores[name], known: evidence.scores[name] !== null })),
    recommended: courses.map(c => ({ ...plain(c), starterLabel: c.starter ? 'Starter course' : '' })),
    recentCredentials: credentials.slice(0, 3).map(c => ({ ...plain(c), date: date(c.issuedAt) })) });
};
export const profilePage = async (req, res) => {
  const profile = plain(await StudentProfile.findOne({ where: { userId: req.user.id } })) || {};
  render(res, 'profile', { title: 'My profile', profile, googleConnected: Boolean(req.user.googleId), googleReady: googleReady() });
};
export const saveProfile = async (req, res) => {
  let data, studentId, section, name;
  try {
    data = profileInput(req.body); studentId = text(req.body.studentId, 40); section = text(req.body.section, 60); name = text(req.body.name, 100);
    if (!/^[\w-]{3,40}$/.test(studentId) || !section || name.length < 2) throw new Error('Enter your full name, Student ID and section.');
  } catch (err) { req.flash('error_msg', err.message); return res.redirect('/student/profile'); }
  try {
    await sequelize.transaction(async transaction => {
      await req.user.update({ name, studentId, section }, { transaction });
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
  const courses = (await Course.findAll({ where: { published: true }, order: [['title', 'ASC']] })).map(plain);
  const attempts = await attemptsFor(req.user.id);
  const completedIds = new Set(attempts.filter(a => a.status === 'completed').map(a => a.courseId));
  const query = text(req.query.q, 100).toLowerCase(); const domain = text(req.query.domain, 60);
  const cards = courses.filter(c => (!query || `${c.title} ${c.description}`.toLowerCase().includes(query)) && (!domain || c.domain === domain)).map(c => {
    const active = attempts.find(a => a.courseId === c.id && a.status === 'ongoing');
    const locked = c.prerequisites.some(id => !completedIds.has(Number(id)));
    return { ...c, active, locked, done: completedIds.has(c.id), moduleCount: c.modules.length, lessonCount: c.modules.reduce((sum, m) => sum + m.lessons.length, 0) };
  });
  render(res, 'catalog', { title: 'Explore courses', courses: cards, domains, query: text(req.query.q, 100), selectedDomain: domain });
};
export const courseDetail = async (req, res) => {
  const course = plain(await Course.findOne({ where: { id: req.params.id, published: true } }));
  if (!course) return fail(res, 'Course not found.', 404);
  const attempts = (await CourseAttempt.findAll({ where: { userId: req.user.id, courseId: course.id }, order: [['attemptNumber', 'DESC']] })).map(plain);
  const active = attempts.find(a => a.status === 'ongoing');
  render(res, 'course', { title: course.title, course, active, attempts: attempts.map(decorate),
    modules: course.modules.map(m => ({ title: m.title, lessons: m.lessons.map(l => ({ title: l.title })) })) });
};
export const enroll = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const course = await Course.findOne({ where: { id: req.params.id, published: true } });
  if (!course) return fail(res, 'Course not found.', 404);
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
  render(res, 'learning', { title: 'My learning', ongoing: attempts.filter(a => !a.completed), completed: attempts.filter(a => a.completed) });
};
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
    const m = modules.find(m => m.available && m.lessons.some(l => !l.completed)) || modules[0];
    selected = { ...(m.lessons.find(l => !l.completed) || m.lessons[0]), moduleTitle: m.title };
  }
  render(res, 'learn', { title: course.title, attempt: decorate(attempt), modules, selected, finalAvailable: canTakeFinal(attempt), completed: attempt.status === 'completed' });
};
export const completeLesson = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    if (!attempt) { const err = new Error('Attempt not found.'); err.status = 404; throw err; }
    if (attempt.status === 'completed') return;
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
export const quizPage = async (req, res) => {
  const attempt = plain(await ownedAttempt(req)); if (!attempt) return fail(res, 'Attempt not found.', 404);
  if (attempt.status === 'completed') return res.redirect(`/student/learn/${attempt.id}`);
  const scope = req.params.moduleId || 'final';
  const final = scope === 'final';
  if (final ? !canTakeFinal(attempt) : !canTakeQuiz(attempt, scope)) return fail(res, 'Complete the required lessons and quizzes first.', 403);
  const questions = final ? attempt.snapshot.questions : attempt.snapshot.questions.filter(q => q.moduleId === scope);
  render(res, 'quiz', { title: final ? 'Final assessment' : 'Module quiz', questions: publicQuestions(questions), attempt,
    scope, final, challenge: issueChallenge(req.user.id, `${attempt.id}:${scope}`) });
};
export const submitQuiz = async (req, res) => {
  const scope = req.params.moduleId || 'final'; const final = scope === 'final';
  const nonce = checkChallenge(req.body.challenge, req.user.id, `${req.params.id}:${scope}`);
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    if (!attempt) { const err = new Error('Attempt not found.'); err.status = 404; throw err; }
    if (attempt.status === 'completed' || attempt.quizAttempts.some(a => a.nonce === nonce)) return;
    if (final ? !canTakeFinal(attempt) : !canTakeQuiz(attempt, scope)) { const err = new Error('Requirements are incomplete.'); err.status = 403; throw err; }
    const questions = final ? attempt.snapshot.questions : attempt.snapshot.questions.filter(q => q.moduleId === scope);
    const result = grade(questions, req.body.answers || {});
    const passed = result.score >= attempt.snapshot.passingScore;
    const update = { quizAttempts: [...attempt.quizAttempts, { nonce, scope, score: result.score, at: new Date().toISOString() }], lastActivityAt: new Date() };
    if (final) update.finalScore = result.score;
    else update.quizScores = { ...attempt.quizScores, [scope]: Math.max(attempt.quizScores[scope] || 0, result.score) };
    if (final && passed) {
      update.status = 'completed'; update.completedAt = new Date();
      await Notification.create({ userId: req.user.id, title: 'Achievement unlocked', message: `You completed ${attempt.snapshot.title}. Your certificate and badge are ready.`, href: '/student/achievements' }, { transaction });
      await Credential.create({ userId: req.user.id, attemptId: attempt.id, courseTitle: attempt.snapshot.title, recipientName: req.user.name,
        courseVersion: attempt.courseVersion, score: result.score, stars: starsFor(result.score), issuedAt: new Date() }, { transaction });
    }
    await attempt.update(update, { transaction });
    req.flash(passed ? 'success_msg' : 'error_msg', `${final ? 'Final assessment' : 'Module quiz'}: ${result.score}%. ${passed ? final ? 'Course completed! Your certificate and badge are ready.' : 'Passed. The next module is available.' : 'Review the lessons, then try again.'}`);
  });
  delete req.session.careerAi;
  res.redirect(`/student/learn/${req.params.id}`);
};
export const assessmentPage = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const history = await Assessment.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  render(res, 'assessment', { title: 'Knowledge diagnostic', questions: publicQuestions(baselineQuestions),
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
  });
  delete req.session.careerAi;
  req.flash('success_msg', 'Knowledge diagnostic saved. Review your results and recommended learning areas.');
  res.redirect('/student/results');
};
export const results = async (req, res) => {
  const attempts = await attemptsFor(req.user.id);
  const assessments = await Assessment.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const evidence = careerMatches(attempts, plain(assessments[0]));
  render(res, 'results', { title: 'My results & skills gaps', domains: domains.map(name => ({ name, score: evidence.scores[name], known: evidence.scores[name] !== null, gap: evidence.scores[name] === null || evidence.scores[name] < 75 })),
    attempts: attempts.map(decorate), assessments: assessments.map(a => ({ ...plain(a), date: date(a.createdAt) })) });
};
export const careers = async (req, res) => {
  const [attempts, baseline, profile, courses] = await Promise.all([
    attemptsFor(req.user.id), Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] }),
    StudentProfile.findOne({ where: { userId: req.user.id } }), Course.findAll({ where: { published: true } })
  ]);
  const evidence = careerMatches(attempts, plain(baseline), profile?.careerInterest);
  const recommendations = courses.filter(c => evidence.scores[c.domain] === null || evidence.scores[c.domain] < 75).map(plain);
  render(res, 'careers', { title: 'Career pathways', tracks: evidence.tracks, recommendations,
    aiReady: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL), ai: req.session.careerAi || null });
};
export const generateGuidance = async (req, res) => {
  if (req.body.consent !== 'yes') return fail(res, 'Confirm that anonymised scores may be sent to Gemini.');
  const attempts = await attemptsFor(req.user.id);
  const baseline = await Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  if (!baseline && !attempts.some(a => a.status === 'completed')) return fail(res, 'Complete a diagnostic or a course first.');
  try {
    const ai = await explainCareer(careerMatches(attempts, plain(baseline)));
    if (!ai) throw new Error('Gemini is not configured yet.');
    req.session.careerAi = { ...ai, generatedAt: date(new Date()) };
    req.flash('success_msg', 'AI learning guidance generated. Review it alongside your assessed results.');
  } catch (err) { req.flash('error_msg', err.message === 'Gemini is not configured yet.' ? err.message : 'AI guidance is temporarily unavailable. Your evidence-based pathways remain available.'); }
  res.redirect('/student/careers');
};
export const achievements = async (req, res) => {
  const rows = await Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] });
  render(res, 'achievements', { title: 'My achievements', credentials: rows.map(c => ({ ...plain(c), date: date(c.issuedAt), starsText: '★'.repeat(c.stars) })) });
};
async function ownedCredential(req) {
  return Credential.findOne({ where: { id: req.params.id, userId: req.user.id, revoked: false } });
}
export const certificate = async (req, res) => {
  const c = await ownedCredential(req); if (!c) return fail(res, 'Certificate not found.', 404);
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `attachment; filename="CareerBridge-${c.id}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 55 });
  doc.on('error', () => res.end()); doc.pipe(res);
  doc.rect(25, 25, 792, 545).lineWidth(2).stroke('#007042');
  doc.fillColor('#007042').fontSize(17).text('BSTM CAREERBRIDGE', { align: 'center' });
  doc.moveDown().fillColor('#172533').fontSize(30).text('Certificate of Completion', { align: 'center' });
  doc.moveDown().fontSize(12).text('This certifies that', { align: 'center' });
  doc.moveDown().fontSize(26).text(c.recipientName, { align: 'center' });
  doc.moveDown().fontSize(13).text('successfully completed the learning requirements for', { align: 'center' });
  doc.moveDown().fontSize(22).text(c.courseTitle, { align: 'center' });
  doc.moveDown().fontSize(12).text(`Version ${c.courseVersion}  |  Final score: ${c.score}%  |  Issued: ${date(c.issuedAt)}`, { align: 'center' });
  doc.moveDown().fontSize(10).text('Platform course completion record. Not a TESDA or professional licence.', { align: 'center' });
  const url = `${appUrl}/verify/${c.id}`;
  doc.moveDown().fillColor('#007042').fontSize(9).text(`Verify: ${url}`, { align: 'center', link: url });
  doc.moveDown().fillColor('#64748b').text(`Credential ID: ${c.id}`, { align: 'center' }); doc.end();
};
export const badge = async (req, res) => {
  const c = await ownedCredential(req); if (!c) return fail(res, 'Badge not found.', 404);
  // Fixed SVG contains no user input; course title stays in the achievement UI.
  res.set('Content-Type', 'image/svg+xml'); res.set('Content-Disposition', `attachment; filename="CareerBridge-badge-${c.id}.svg"`);
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="440" viewBox="0 0 400 440"><rect width="400" height="440" rx="24" fill="#f3faf6"/><path d="M200 35 345 105v140L200 365 55 245V105Z" fill="#007042"/><circle cx="200" cy="180" r="78" fill="#fff"/><path d="m152 180 32 32 65-65" fill="none" stroke="#007042" stroke-width="18"/><g fill="white" text-anchor="middle" font-family="Arial"><text x="200" y="290" font-size="19">COURSE COMPLETED</text><text x="200" y="322" font-size="20">${'★'.repeat(c.stars)}</text></g><text x="200" y="405" text-anchor="middle" font-family="Arial" fill="#007042" font-size="20">BSTM CAREERBRIDGE</text></svg>`);
};
export const verify = async (req, res) => {
  const c = await Credential.findByPk(req.params.id);
  if (!c) return res.status(404).render('verify', { title: 'Credential not found', missing: true });
  res.render('verify', { title: 'Verify credential', credential: { ...plain(c), date: date(c.issuedAt) } });
};
export const downloadReport = async (req, res) => {
  const attempts = await attemptsFor(req.user.id);
  const baseline = await Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const evidence = careerMatches(attempts, plain(baseline));
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
