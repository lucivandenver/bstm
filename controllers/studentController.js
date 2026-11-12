import { profileFacultySignature } from '../services/publicationCredentials.js';
import { moduleEvidence, studentCareerEvidence } from '../services/moduleEvidence.js';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { buildEvidence } from '../services/evidence.js';
import QRCode from 'qrcode';
import { Op } from 'sequelize';
import { DiagnosticDraft, CourseAssignment, QuizDraft, PracticalSubmission, CourseFeedback, FacultyNote, ProfileCorrection, StudentFile, CredentialRequest, SourceFilePart } from '../models/portalModels.js';
import { Section } from '../models/adminModels.js';
import { finalizeAttempt, ensureCompletionCredential, draftFor, scopeQuestions, validateDraftAnswers, checkQuizLimits, quizAccess, assessmentSubmissions, syncPublishedAttempt } from '../services/portalLearning.js';
import { fail as error } from '../services/courseAuthoring.js';
import { CareerPath } from '../models/adminModels.js';
import { setting, genders } from '../services/accounts.js';
import PDFDocument from 'pdfkit';
import { Course, CourseAttempt, StudentProfile, Assessment, Credential, Notification, SavedCourse, SavedModule, sequelize } from '../models/learningModels.js';
import { User } from '../models/userModel.js';
import { text, email as normalizeEmail, profileInput, topicTitle } from '../services/validation.js';
import { baselineQuestions, domains } from '../data/starterCourses.js';
import { progress, publishedAttemptSnapshot, canTakeQuiz, canTakeFinal, grade, starsFor, publicQuestions, issueChallenge, checkChallenge, defaultCareerTracks } from '../services/learning.js';
import { explainCareer, careerFingerprint } from '../services/careerAi.js';
import { aiConfiguration } from '../services/gemini.js';
import { courseAiConfiguration } from '../services/courseAiProvider.js';
import { appUrl } from '../config/env.js';
import { readFile } from 'node:fs/promises';
const plain = row => row?.get({ plain: true });
const date = value => value ? new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const studentBack = { careers: '/student', profile: '/student', assessment: '/student/results',
  results: '/student', achievements: '/student/learning', notifications: '/student', activities: '/student/learning' };
const render = (res, view, data = {}) => res.render(`student/${view}`, { nav: view, backUrl: studentBack[view], ...data });
const fail = (res, message, status = 400) => res.status(status).render('student/message', { title: 'Unable to continue', message });
async function activeCareerTracks() {
  const configured = (await CareerPath.findAll({ where: { active: true } })).map(plain);
  return configured.length ? configured : defaultCareerTracks.map(track => ({ ...track, qualifications: null, active: true }));
}
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
  const [attempts, profile, credentials, baseline] = await Promise.all([
    attemptsFor(req.user.id), StudentProfile.findOne({ where: { userId: req.user.id } }),
    Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] }),
    Assessment.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })
  ]);
  const completed = attempts.filter(a => a.status === 'completed');
  const ongoing = await visibleOngoingAttempts(attempts);
  const { competencies } = moduleEvidence(attempts);
  render(res, 'dashboard', { title: 'My dashboard', profileComplete: profile?.complete && req.user.studentId && req.user.section && genders.includes(req.user.gender),
    completedCount: completed.length, credentialCount: credentials.length, activeCount: ongoing.length,
    totalStars: credentials.reduce((sum, c) => sum + c.stars, 0), baseline: plain(baseline),
    competencies,
    recentCredentials: credentials.slice(0, 3).map(c => ({ ...plain(c), date: date(c.issuedAt) })) });
};
export const profilePage = async (req, res) => {
  const profile = plain(await StudentProfile.findOne({ where: { userId: req.user.id } })) || {};
  const activeSections = await Section.findAll({ where: { active: true }, attributes: ['name'], order: [['name', 'ASC']] });
  const sections = [...new Set([req.user.section, ...activeSections.map(section => section.name)].filter(Boolean))];
  render(res, 'profile', { title: 'My profile', profile, genders, sections });
};
export const saveProfile = async (req, res) => {
  let data, studentId, section, name, accountEmail, gender;
  try {
    data = profileInput(req.body);
    gender = text(req.body.gender, 30); studentId = text(req.body.studentId, 40); section = text(req.body.section, 60); name = text(req.body.name, 100); accountEmail = normalizeEmail(req.body.email);
    if (!genders.includes(gender)) throw new Error('Select your gender.');
    if (!/^[\w-]{3,40}$/.test(studentId) || !section || name.length < 2) throw new Error('Enter your full name, Student ID and section.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) throw new Error('Enter a valid email address.');
    if (section !== req.user.section && !await Section.findOne({ where: { name: section, active: true } })) throw new Error('Choose an active academic section.');
  } catch (err) { req.flash('error_msg', err.message); return res.redirect('/student/profile'); }
  try {
    await sequelize.transaction(async transaction => {
      await req.user.update({ name, email: accountEmail, studentId, section, gender, ...(accountEmail !== req.user.email ? { emailVerified: false } : {}) }, { transaction });
      const [profile] = await StudentProfile.findOrCreate({ where: { userId: req.user.id }, defaults: data, transaction });
      await profile.update(data, { transaction });
    });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    req.flash('error_msg', 'That email address or Student ID is already in use.'); return res.redirect('/student/profile');
  }
  req.flash('success_msg', 'Your profile has been saved.'); res.redirect('/student/profile');
};
export const catalog = async (req, res) => {
  const [courses, attempts, savedRows] = await Promise.all([
    Course.findAll({ where: { published: true, ownerId: { [Op.not]: null } }, order: [['title', 'ASC']] }),
    attemptsFor(req.user.id),
    SavedModule.findAll({ where: { userId: req.user.id } })
  ]);
  const ownerIds = [...new Set(courses.map(course => course.ownerId))];
  const facultyRows = ownerIds.length ? await User.findAll({ where: { id: { [Op.in]: ownerIds }, role: 'faculty', approvalStatus: 'approved', active: true }, attributes: ['id', 'name'] }) : [];
  const facultyById = new Map(facultyRows.map(user => [user.id, user.name]));
  const visible = courses.filter(course => facultyById.has(course.ownerId) && course.modules.length);
  const savedByCourse = new Map();
  for (const row of savedRows) {
    if (recordedModule(attempts.filter(attempt => attempt.courseId === row.courseId), row.moduleId)) continue;
    if (!savedByCourse.has(row.courseId)) savedByCourse.set(row.courseId, new Set());
    savedByCourse.get(row.courseId).add(row.moduleId);
  }
  const view = ['saved', 'enrolled'].includes(req.query.view) ? req.query.view : 'all';
  const enrolledIds = new Set(attempts.map(attempt => attempt.courseId));
  const query = text(req.query.q, 100);
  const search = query.toLowerCase();
  const domain = text(req.query.domain, 60);
  const matchesDomain = course => !domain || (course.competencyAreas?.length ? course.competencyAreas : [course.domain]).includes(domain);
  const matchesModule = (course, module) => [course.title, module.title, ...module.lessons.map(lesson => lesson.title)]
    .some(value => value.toLowerCase().includes(search));
  const saved = visible.flatMap(course => course.modules.flatMap((module, index) =>
    savedByCourse.get(course.id)?.has(module.id)
      ? [{ courseId: course.id, courseTitle: course.title, id: module.id, title: module.title,
        number: module.number ?? index + 1, matches: matchesDomain(course) && matchesModule(course, module) }]
      : []));
  const section = await Section.findOne({ where: { name: req.user.section } });
  const assignments = section ? await CourseAssignment.findAll({ where: { sectionId: section.id } }) : [];
  const cards = view === 'saved' ? [] : visible
    .filter(course => view !== 'enrolled' || enrolledIds.has(course.id))
    .filter(course => matchesDomain(course) && (!search ||
      (course.description || '').toLowerCase().includes(search) || course.modules.some(module => matchesModule(course, module))))
    .map(course => ({
      ...plain(course), author: facultyById.get(course.ownerId), moduleCount: course.modules.length,
      required: assignments.some(assignment => assignment.courseId === course.id && assignment.required),
      due: date(assignments.find(assignment => assignment.courseId === course.id)?.dueAt)
    }));
  render(res, 'catalog', {
    title: 'Explore courses', courses: cards, savedModules: saved.filter(module => module.matches),
    hasRequired: cards.some(course => course.required), domains, query, selectedDomain: domain, view,
    savedCount: saved.length, enrolledCount: visible.filter(course => enrolledIds.has(course.id)).length
  });
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
export const saveModule = async (req, res) => {
  const course = await Course.findOne({ where: { id: req.params.id, published: true, ownerId: { [Op.not]: null } } });
  const owner = course && await User.findOne({ where: { id: course.ownerId, role: 'faculty', active: true, approvalStatus: 'approved' } });
  if (!owner || !course.modules.some(module => module.id === req.params.moduleId)) return fail(res, 'Module not found.', 404);
  const attempts = await CourseAttempt.findAll({ where: { userId: req.user.id, courseId: course.id } });
  if (!recordedModule(attempts, req.params.moduleId)) {
      await SavedModule.findOrCreate({ where: { userId: req.user.id, courseId: course.id, moduleId: req.params.moduleId } });
  }
  res.redirect(`/student/courses/${course.id}#module-${req.params.moduleId}`);
};
export const unsaveModule = async (req, res) => {
  await SavedModule.destroy({ where: { userId: req.user.id, courseId: req.params.id, moduleId: req.params.moduleId } });
  res.redirect(req.body.returnTo === 'saved' ? '/student/courses?view=saved' : `/student/courses/${encodeURIComponent(req.params.id)}`);
};
export const courseDetail = async (req, res) => {
  const courseRow = await Course.findOne({ where: { id: req.params.id, published: true, ownerId: { [Op.not]: null } } });
  const owner = courseRow && await User.findOne({ where: { id: courseRow.ownerId, role: 'faculty', approvalStatus: 'approved', active: true } });
  const course = owner ? plain(courseRow) : null;
  if (!course) return fail(res, 'Course not found.', 404);
  const [attemptRows, savedModules] = await Promise.all([
    CourseAttempt.findAll({ where: { userId: req.user.id, courseId: course.id }, order: [['attemptNumber', 'DESC']] }),
    SavedModule.findAll({ where: { userId: req.user.id, courseId: course.id } })
  ]);
  const attempts = attemptRows.map(plain).map(attempt => attempt.status === 'ongoing'
    ? { ...attempt, ...publishedAttemptSnapshot(attempt, course) } : attempt);
  render(res, 'course', { title: course.title, course, attempts: attempts.map(decorate),
    author: owner.name || 'CareerBridge faculty', prerequisites: (await Course.findAll({ where: { id: { [Op.in]: course.prerequisites } }, attributes: ['id', 'title'] })).map(plain),
    modules: course.modules.map((module, index) => {
      const record = recordedModule(attempts, module.id);
      return { ...module, number: module.number ?? index + 1, progress: record,
        saved: !record && savedModules.some(row => row.moduleId === module.id),
        reviewHref: record?.passed && moduleReviewHref(record.attempt, module.id),
        resumeHref: record && !record.passed && moduleStartHref(record.attempt, module.id)
      };
    }) });
};
function moduleReviewHref(attempt, moduleId) {
  const lesson = attempt.snapshot.modules.find(module => module.id === moduleId)?.lessons[0];
  return lesson ? `/student/learn/${attempt.id}?lesson=${encodeURIComponent(lesson.id)}` : null;
}
async function publishedCourse(id, transaction) {
  const course = await Course.findOne({
    where: { id, published: true, ownerId: { [Op.not]: null } },
    transaction, lock: transaction.LOCK.UPDATE
  });
  if (!course?.modules.length) return null;
  const owner = await User.findOne({
    where: { id: course.ownerId, role: 'faculty', approvalStatus: 'approved', active: true }, transaction
  });
  return owner ? course : null;
}
export const enroll = async (req, res) => {
  if (!await requireProfile(req, res)) return;
  const moduleId = req.body.moduleId;
  const attempt = await sequelize.transaction(async transaction => {
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
    const course = await publishedCourse(req.params.id, transaction);
    if (!course) error('Course not found.', 404);
    if (moduleId && !course.modules.some(module => module.id === moduleId)) error('Module not found.', 404);

    const previous = await CourseAttempt.findAll({
      where: { userId: req.user.id, courseId: course.id }, order: [['attemptNumber', 'DESC']], transaction, lock: transaction.LOCK.UPDATE
    });
    const active = previous.find(attempt => attempt.status === 'ongoing');
    if (active) return syncPublishedAttempt(active, course, transaction);
    const completed = previous.find(attempt => attempt.status === 'completed');
    if (completed && course.modules.every(module => completed.snapshot.modules.some(item => item.id === module.id))) return completed;

    if (!moduleId) {
      const now = Date.now();
      if ((course.enrollFrom && new Date(course.enrollFrom) > now) || (course.enrollUntil && new Date(course.enrollUntil) < now)) {
        error('Enrollment is currently closed for this course.');
      }
      for (const prerequisite of course.prerequisites) {
        if (!await CourseAttempt.findOne({ where: { userId: req.user.id, courseId: Number(prerequisite), status: 'completed' }, transaction })) {
          error('Complete the prerequisite courses first.');
        }
      }
    }
    const moduleScoreKeys = course.modules.flatMap(module => [module.id, `read:${module.id}`]);
    const carriedScores = Object.fromEntries(Object.entries(completed?.quizScores || {})
      .filter(([key]) => moduleScoreKeys.includes(key)));
    const created = await CourseAttempt.create({
      userId: req.user.id, courseId: course.id, attemptNumber: (previous[0]?.attemptNumber || 0) + 1,
      courseVersion: course.version, snapshot: plain(course),
      completedLessons: completed?.completedLessons || [], quizScores: carriedScores, quizAttempts: [],
      lastActivityAt: new Date()
    }, { transaction });
    await Notification.create({ userId: req.user.id, title: 'Your course is ready', message: `You started ${course.title}, attempt ${created.attemptNumber}.`, href: `/student/learn/${created.id}` }, { transaction });
    return created;
  });
  const href = attempt.status === 'completed' ? moduleReviewHref(attempt, moduleId) : moduleStartHref(attempt, moduleId);
  res.redirect(href || `/student/learn/${attempt.id}`);
};
async function visibleOngoingAttempts(attempts) {
  const ongoing = attempts.filter(attempt => attempt.status === 'ongoing');
  if (!ongoing.length) return [];
  const courses = await Course.findAll({ where: {
    id: ongoing.map(attempt => attempt.courseId), published: true, ownerId: { [Op.not]: null }
  } });
  const owners = await User.findAll({ where: {
    id: courses.map(course => course.ownerId), role: 'faculty', approvalStatus: 'approved', active: true
  }, attributes: ['id'] });
  const approved = new Set(owners.map(owner => owner.id));
  const visible = new Map(courses.filter(course => course.modules.length && approved.has(course.ownerId)).map(course => [course.id, course]));
  return ongoing.flatMap(attempt => {
    const course = visible.get(attempt.courseId);
    return course ? [{ ...attempt, ...publishedAttemptSnapshot(attempt, course) }] : [];
  });
}
function moduleStartHref(attempt, moduleId) {
  if (attempt.status === 'completed') return null;
  const modules = attempt.snapshot.modules;
  const module = modules.find(item => item.id === moduleId);
  if (!module) return null;
  if (module.lessons.some(item => attempt.completedLessons.includes(item.id)) &&
      (!module.materials?.length || attempt.quizScores[`read:${module.id}`])) {
    return `/student/learn/${attempt.id}?module=${encodeURIComponent(module.id)}`;
  }
  const lesson = module.lessons[0];
  return lesson ? `/student/learn/${attempt.id}?lesson=${encodeURIComponent(lesson.id)}` : null;
}

export const myLearning = async (req, res) => {
  const attempts = await attemptsFor(req.user.id);
  const ongoing = (await visibleOngoingAttempts(attempts)).map(decorate);
  const activeModules = ongoing.flatMap(attempt => attempt.snapshot.modules.flatMap(module => {
    const progress = moduleProgress(attempt, module);
    return progress.started ? [{ ...attempt, ...progress, moduleTitle: module.title, isModule: true,
      resumeHref: progress.passed ? moduleReviewHref(attempt, module.id) : moduleStartHref(attempt, module.id)
    }] : [];
  }));
  const courseCompletion = ongoing.filter(canTakeFinal).map(attempt => ({
    ...attempt, moduleTitle: attempt.title, statusLabel: 'Course completion', resumeHref: resumeHref(attempt)
  }));
  render(res, 'learning', { title: 'My learning', ongoing: [...activeModules.filter(module => !module.passed), ...courseCompletion],
    passedModules: activeModules.filter(module => module.passed), completed: attempts.filter(a => a.status === 'completed').map(decorate),
    learningHistory: attempts.map(decorate).flatMap(a => a.quizAttempts.map(result => ({ title: a.title, attemptNumber: a.attemptNumber, scope: result.scope === 'final' ? 'Final assessment' : result.scope === 'pretest' ? 'Course pre-test' : `Module quiz · ${a.snapshot.modules.find(m => m.id === result.scope)?.title || result.scope}`, score: result.score, passed: result.score >= a.snapshot.passingScore, date: date(result.at) }))).slice(0, 30) });
};
function resumeHref(attempt) {
  if (attempt.status === 'completed') return `/student/learn/${attempt.id}`;
  if (attempt.snapshot.policy?.pretest && !attempt.quizAttempts.some(q => q.scope === 'pretest')) return `/student/learn/${attempt.id}/quiz/pretest`;
  for (const module of attempt.snapshot.modules) {
    if (module.materials?.length && !attempt.quizScores[`read:${module.id}`]) return `/student/learn/${attempt.id}?lesson=${encodeURIComponent(module.lessons[0].id)}`;
    const unfinished = module.lessons.find(lesson => !attempt.completedLessons.includes(lesson.id));
    if (unfinished) return moduleStartHref(attempt, module.id);
    if (!(attempt.quizScores[module.id] >= attempt.snapshot.passingScore)) return moduleStartHref(attempt, module.id);
  }
  if (finalFeedbackAvailable(attempt)) return `/student/learn/${attempt.id}/activities`;
  if (canTakeFinal(attempt)) return `/student/learn/${attempt.id}/final`;
  return `/student/learn/${attempt.id}`;
}
async function ownedAttempt(req, transaction) {
  if (!transaction) return sequelize.transaction(tx => ownedAttempt(req, tx));
  const where = { id: req.params.id, userId: req.user.id };
  const initial = await CourseAttempt.findOne({ where, transaction });
  if (!initial || initial.status === 'completed') return initial;
  const course = await publishedCourse(initial.courseId, transaction);
  const attempt = await CourseAttempt.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
  if (!attempt || attempt.status === 'completed') return attempt;
  return course ? syncPublishedAttempt(attempt, course, transaction) : null;
}
function selectedMaterialModule(attempt, moduleId) {
  return attempt.snapshot.modules.find(module => module.id === moduleId);
}
export const moduleMaterial = async (req, res) => {
  const attempt = await ownedAttempt(req);
  const module = attempt && selectedMaterialModule(attempt, req.params.moduleId);
  const material = module?.materials?.find(file => file.sourceId === Number(req.params.sourceId) && file.documentKey === req.params.key);
  if (!material) return fail(res, 'Module material not found.', 404);
  const where = { ...material, ownerId: attempt.snapshot.ownerId, part: 0 };
  const file = await SourceFilePart.findOne({ where, attributes: ['filename', 'bytes'] });
  if (!file) return fail(res, 'Module material not found.', 404);
  const inline = /\.pdf$/i.test(file.filename);
  res.attachment(file.filename);
  if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(file.bytes) });
  await pipeline((async function* () {
    for (let part = 0; part * 256 * 1024 < file.bytes; part++) {
      const row = await SourceFilePart.findOne({ where: { ...where, part }, attributes: ['content'] });
      if (!row) throw new Error('Module material is incomplete.');
      yield row.content;
    }
  })(), res);
};
function removeStartedBookmark(attempt, moduleId, transaction) {
  return SavedModule.destroy({ where: { userId: attempt.userId, courseId: attempt.courseId, moduleId }, transaction });
}
export const confirmModuleReading = async (req, res) => {
  const href = await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    const module = attempt && selectedMaterialModule(attempt, req.params.moduleId);
    if (!module?.materials?.length || attempt.status === 'completed' || req.body.read !== 'yes') error('Confirm that you read the module materials.', 400);
    await attempt.update({ quizScores: { ...attempt.quizScores, [`read:${module.id}`]: 1 }, lastActivityAt: new Date() }, { transaction });
    await removeStartedBookmark(attempt, module.id, transaction);
    return moduleStartHref(plain(attempt), module.id) || resumeHref(attempt);
  });
  res.redirect(href);
};
function moduleProgress(attempt, module) {
  const submissions = assessmentSubmissions(attempt, module.id);
  const results = submissions.filter(result => !result.expired);
  const recordedRetakes = attempt.quizScores[`retake:${module.id}`] || 0;
  const retakeCount = Math.max(recordedRetakes, results.length - 1);
  const storedScore = attempt.quizScores[module.id];
  const passed = storedScore >= attempt.snapshot.passingScore;
  const retakeInProgress = recordedRetakes > 0 && typeof storedScore !== 'number';
  const score = retakeInProgress ? undefined : passed ? storedScore : results.at(-1)?.score ?? storedScore;
  const answered = typeof score === 'number';
  const failed = answered && !passed;
  const limit = attempt.snapshot.policy?.attemptLimit;
  const canRetake = failed && attempt.status === 'ongoing' && (!limit || submissions.length < limit);
  const retakeUrl = canRetake && `/student/learn/${attempt.id}/retake/${encodeURIComponent(module.id)}`;
  const read = Boolean(attempt.quizScores[`read:${module.id}`]);
  const lessonsDone = module.lessons.filter(lesson => attempt.completedLessons.includes(lesson.id)).length;
  const done = lessonsDone + Number(read && Boolean(module.materials?.length)) + Number(answered);
  const total = module.lessons.length + Number(Boolean(module.materials?.length)) + 1;
  const started = answered || retakeCount > 0 || (module.materials?.length ? read : lessonsDone > 0);
  return { started, passed, failed, answered, score, retakeCount, retakeUrl, done, total, percent: started ? Math.round(done / total * 100) : 0,
    statusLabel: passed ? 'Passed' : answered ? 'Failed' : 'In progress' };
}
function recordedModule(attempts, moduleId) {
  for (const attempt of attempts) {
    const module = attempt.snapshot.modules.find(item => item.id === moduleId);
    if (!module) continue;
    const progress = moduleProgress(attempt, module);
    if (progress.started) return { attempt, ...progress };
  }
  return null;
}
function finalFeedbackAvailable(attempt) {
  return assessmentSubmissions(attempt, 'final').some(result => !result.expired && result.score >= attempt.snapshot.passingScore);
}
function quizSeconds(attempt, draft) {
  return Math.max(0, Math.floor((new Date(draft.startedAt).getTime() + attempt.snapshot.policy.quizMinutes * 60000 - Date.now()) / 1000));
}
function moduleOutline(attempt, module, index, draft) {
  const questions = scopeQuestions(attempt, module.id);
  const topics = assessmentTopics(module, questions, draft || { answers: {} });
  const progress = moduleProgress(attempt, module);
  const readingReady = !module.materials?.length || Boolean(attempt.quizScores[`read:${module.id}`]);
  const reviewing = attempt.status === 'completed';
  let unlocked = true;
  const lessons = module.lessons.map((lesson, lessonIndex) => {
    const topicQuestions = topics.find(topic => topic.id === lesson.id)?.questions || [];
    const lectureDone = (reviewing || unlocked && readingReady) && attempt.completedLessons.includes(lesson.id);
    const quizDone = Boolean(topicQuestions.length && lectureDone && (progress.answered ||
      topicQuestions.every(question => question.options.some(option => option.checked))));
    const quizOpen = unlocked && lectureDone && topicQuestions.length && !progress.answered && !reviewing && quizAccess(attempt, module.id);
    const done = lectureDone && (!topicQuestions.length || quizDone);
    const available = reviewing || unlocked;
    unlocked = unlocked && done;
    return {
      ...lesson, title: topicTitle(lesson.title), number: `${module.number ?? index + 1}.${lessonIndex + 1}`,
      unlocked: available, lectureDone, completed: done, done, questions: topicQuestions, quizDone, quizOpen
    };
  });
  return { ...module, ...progress, title: topicTitle(module.title), lessons, readingReady,
    questionCount: questions.length, quizAvailable: scopeAllowed(attempt, module.id) && (unlocked || reviewing),
    reviewAvailable: progress.passed && (reviewing || attempt.snapshot.policy?.feedbackTiming !== 'after-completion') };
}
function learningOutline(attempt, drafts = new Map(), moduleId) {
  return {
    modules: attempt.snapshot.modules.flatMap((module, index) => !moduleId || module.id === moduleId
      ? [moduleOutline(attempt, module, index, drafts.get(module.id))] : []),
    moduleOnly: Boolean(moduleId),
    finalAvailable: canTakeFinal(attempt), finalFeedbackAvailable: finalFeedbackAvailable(attempt),
    completed: attempt.status === 'completed'
  };
}
async function assessmentOutline(attempt, scope) {
  const moduleId = attempt.snapshot.modules.find(module => module.id === scope)?.id;
  const drafts = await QuizDraft.findAll({
    where: { userId: attempt.userId, attemptId: attempt.id, ...(moduleId ? { scope: moduleId } : {}) }
  });
  return { ...learningOutline(attempt, new Map(drafts.map(draft => [draft.scope, draft])), moduleId), attempt: decorate(attempt.get ? plain(attempt) : attempt) };
}
function topicHref(attempt, lesson, quiz = false) {
  return `/student/learn/${attempt.id}?lesson=${encodeURIComponent(lesson.id)}${quiz ? '#topic-quiz' : ''}`;
}
export const learn = async (req, res) => {
  const row = await ownedAttempt(req); if (!row) return fail(res, 'Learning attempt not found.', 404);
  const attempt = plain(row); const course = attempt.snapshot;
  const requestedModule = req.query.module && course.modules.find(module => module.id === req.query.module);
  if (req.query.module && !requestedModule) return fail(res, 'Module not found.', 404);
  const requestedTopicModule = req.query.lesson && (requestedModule ? [requestedModule] : course.modules)
    .find(module => module.lessons.some(lesson => lesson.id === req.query.lesson));
  if (req.query.lesson && !requestedTopicModule) return fail(res, 'This topic is not available in the selected module.', 403);
  const moduleId = (requestedModule || requestedTopicModule)?.id;
  const drafts = await QuizDraft.findAll({
    where: { userId: req.user.id, attemptId: attempt.id, ...(moduleId ? { scope: moduleId } : {}) }
  });
  const draftsByScope = new Map(drafts.map(draft => [draft.scope, draft]));
  const outline = learningOutline(attempt, draftsByScope, moduleId);
  const { modules } = outline;
  if (req.query.lesson && !modules[0]?.lessons.some(lesson => lesson.id === req.query.lesson && lesson.unlocked)) {
    return fail(res, 'Complete the previous topic and its questions to unlock this topic.', 403);
  }
  const currentModule = (moduleId && modules[0]) ||
    modules.find(module => module.lessons.some(lesson => lesson.id === attempt.lastLessonId && lesson.unlocked)) ||
    modules.find(module => module.lessons.some(lesson => !lesson.done)) || modules[0];
  const lesson = currentModule?.lessons.find(item => item.id === req.query.lesson) ||
    currentModule?.lessons.find(item => item.unlocked && !item.done) || currentModule?.lessons[0];
  const selected = lesson && { ...lesson, moduleTitle: currentModule.title, moduleId: currentModule.id };
  if (selected?.id && attempt.status !== 'completed' && attempt.lastLessonId !== selected.id) await row.update({ lastLessonId: selected.id, lastActivityAt: new Date() });
  const submissions = await PracticalSubmission.findAll({ where: { attemptId: attempt.id } });
  const lessonChallenge = selected?.id && !selected.lectureDone && currentModule.readingReady && quizAccess(attempt, currentModule.id) && attempt.status !== 'completed'
    ? issueChallenge(req.user.id, `lesson:${attempt.id}:${selected.id}`) : null;
  const references = currentModule?.materials || [];
  const materials = references.length ? await SourceFilePart.findAll({
    where: { ownerId: course.ownerId, part: 0, [Op.or]: references },
    attributes: ['filename', 'sourceId', 'documentKey']
  }) : [];
  const readingConfirmed = Boolean(attempt.quizScores[`read:${currentModule?.id}`]);
  const topicDraft = draftsByScope.get(selected?.moduleId);
  const inlineDraft = selected?.quizOpen ? topicDraft || await draftFor(req.user.id, attempt, selected.moduleId, undefined, false) : null;
  const seconds = inlineDraft?.startedAt && attempt.snapshot.policy?.quizMinutes ? quizSeconds(attempt, inlineDraft) : null;
  render(res, 'learn', { ...outline, topicRevision: inlineDraft?.revision, timedTopic: seconds !== null, remainingSeconds: seconds, topicExpired: seconds === 0, readingRequired: !currentModule?.readingReady, materials: materials.map(file => ({ filename: file.filename, href: `/student/learn/${attempt.id}/materials/${currentModule.id}/${file.sourceId}/${file.documentKey}` })), readingModuleId: currentModule?.id, readingConfirmed, lessonChallenge, tasks: (course.tasks || []).map(t => ({ ...t, submission: plain(submissions.find(s => s.taskId === t.id)) })), hasTasks: Boolean(course.tasks?.length), feedbackRequired: course.policy?.feedbackRequired, pretestNeeded: course.policy?.pretest && !attempt.quizAttempts.some(a => a.scope === 'pretest'), title: outline.moduleOnly ? currentModule.title : course.title, attempt: decorate(attempt), selected, iataIllustration: /\biata\b.*\bcodes?\b/i.test(selected?.title || '') });
};
export const completeLesson = async (req, res) => {
  const next = await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    if (!attempt) { const err = new Error('Attempt not found.'); err.status = 404; throw err; }
    if (attempt.status === 'completed') return resumeHref(attempt);
    if (attempt.snapshot.policy?.pretest && !attempt.quizAttempts.some(q => q.scope === 'pretest')) error('Complete the course pre-test first.',403);
    const index = attempt.snapshot.modules.findIndex(module => module.lessons.some(lesson => lesson.id === req.body.lessonId));
    if (index < 0) error('This lesson is unavailable.', 403);
    const module = attempt.snapshot.modules[index];
    const draft = await QuizDraft.findOne({ where: { attemptId: attempt.id, scope: module.id }, transaction });
    const outline = moduleOutline(attempt, module, index, draft);
    const lesson = outline.lessons.find(item => item.id === req.body.lessonId);
    if (!lesson.unlocked) error('Complete the previous topic and its questions first.', 403);
    if (!outline.readingReady) return topicHref(attempt, lesson);
    if (!attempt.completedLessons.includes(req.body.lessonId)) {
      try {
        checkChallenge(req.body.lessonChallenge, req.user.id, `lesson:${attempt.id}:${req.body.lessonId}`);
      } catch {
        error('Open the lecture and reach the end before completing it. Reload the lesson if it has expired.', 400);
      }
      await attempt.update({ completedLessons: [...attempt.completedLessons, req.body.lessonId], lastActivityAt: new Date() }, { transaction });
      await removeStartedBookmark(attempt, module.id, transaction);
    }
    const updated = moduleOutline(attempt, module, index, draft);
    const current = updated.lessons.find(item => item.id === lesson.id);
    if (!current.done) return topicHref(attempt, current, true);
    const next = updated.lessons.find(item => item.unlocked && !item.done);
    if (next) return topicHref(attempt, next);
    return scopeAllowed(attempt, module.id) ? `/student/learn/${attempt.id}/quiz/${module.id}` : resumeHref(attempt);
  });
  res.redirect(next);
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
  const module = a.snapshot.modules.find(item => item.id === scope);
  if (module?.materials?.length && !a.quizScores[`read:${scope}`]) return false;
  return quizAccess(a, scope) && (scope === 'pretest' || (scope === 'final' ? canTakeFinal(a) : canTakeQuiz(a, scope)));
}
function topicDraftAllowed(attempt, scope) {
  const module = selectedMaterialModule(attempt, scope);
  if (module && moduleProgress(attempt, module).failed) return false;
  if (scopeAllowed(attempt, scope)) return true;
  if (!quizAccess(attempt, scope)) return false;
  return Boolean(module && (!module.materials?.length || attempt.quizScores[`read:${scope}`]) &&
    module.lessons.some(lesson => attempt.completedLessons.includes(lesson.id)));
}
function assessmentTopics(module, questions, draft) {
  const toPublic = question => ({
    ...publicQuestions([question])[0],
    options: question.options.map((label, index) => ({ label, index, checked: String(draft.answers[question.id]) === String(index) }))
  });
  if (!module) return [{ questions: questions.map(toPublic) }];
  const terms = value => new Set(String(value || '').toLowerCase().match(/[a-z]{4,}/g) || []);
  const topics = module.lessons.map((lesson, index) => ({
    id: lesson.id, title: topicTitle(lesson.title), number: index + 1, questions: [],
    titleTerms: terms(lesson.title), bodyTerms: terms(lesson.body), reference: lesson.sourceReference
  }));
  if (!topics.length) return [{ questions: questions.map(toPublic) }];
  for (const question of questions) {
    const assignedTopic = topics.find(topic => topic.id === question.lessonId);
    if (assignedTopic) {
      assignedTopic.questions.push(toPublic(question));
      continue;
    }
    const words = terms(`${question.prompt} ${question.sourceQuote || ''}`);
    let best = topics[0];
    let bestScore = -1;
    for (const topic of topics) {
      const score = [...words].reduce((total, word) => total + (topic.titleTerms.has(word) ? 4 : topic.bodyTerms.has(word) ? 1 : 0), 0) +
        (question.sourceReference && question.sourceReference === topic.reference ? 3 : 0);
      if (score > bestScore || (score === bestScore && topic.questions.length < best.questions.length)) { best = topic; bestScore = score; }
    }
    best.questions.push(toPublic(question));
  }
  return topics.filter(topic => topic.questions.length);
}
export const quizPage = async (req, res) => {
  const attempt = plain(await ownedAttempt(req)); if (!attempt) return fail(res, 'Attempt not found.', 404);
  const scope = req.params.moduleId || 'final', final = scope === 'final';
  if (final && finalFeedbackAvailable(attempt)) return res.redirect(`/student/learn/${attempt.id}/review/final`);
  if (attempt.status === 'completed') return res.redirect(`/student/learn/${attempt.id}`);
  const moduleIndex = attempt.snapshot.modules.findIndex(item => item.id === scope);
  const module = attempt.snapshot.modules[moduleIndex];
  if (module && moduleProgress(attempt, module).failed) {
    return res.redirect(moduleStartHref(attempt, module.id) || `/student/learn/${attempt.id}?module=${encodeURIComponent(module.id)}`);
  }
  if (!topicDraftAllowed(attempt, scope)) return fail(res, 'Complete the required pre-test, lessons and quizzes first.', 403);
  const canSubmit = scopeAllowed(attempt, scope);
  if (module) {
    const saved = await QuizDraft.findOne({ where: { attemptId: attempt.id, scope } });
    const outline = moduleOutline(attempt, module, moduleIndex, saved);
    if (!outline.quizAvailable) return res.redirect(`/student/learn/${attempt.id}?module=${encodeURIComponent(module.id)}`);
  }
  const draft = await draftFor(req.user.id, attempt, scope);
  const questions = scopeQuestions(attempt, scope);
  const retries = assessmentSubmissions(attempt, scope).length;
  const timed = Boolean(attempt.snapshot.policy?.quizMinutes), remaining = timed ? quizSeconds(attempt, draft) : null;
  const limited = scope !== 'pretest' && attempt.snapshot.policy?.attemptLimit && retries >= attempt.snapshot.policy.attemptLimit;
  const topics = assessmentTopics(module, questions, draft)
    .map(topic => module && topic.number ? { ...topic, number: `${module.number ?? moduleIndex + 1}.${topic.number}` } : topic);
  if (retries || attempt.snapshot.policy?.randomize) {
    const rank = (question, attemptNumber) => createHash('sha256').update(`${attempt.id}:${scope}:${attemptNumber}:${question.id}`).digest('hex');
    for (const topic of topics) {
      const items = topic.questions;
      if (final && retries && items.length > 1) {
        const initial = attempt.snapshot.policy?.randomize
          ? [...items].sort((a, b) => rank(a, 0).localeCompare(rank(b, 0))) : items;
        const first = initial[retries % items.length];
        items.splice(items.indexOf(first), 1);
        items.sort((a, b) => rank(a, retries).localeCompare(rank(b, retries)));
        items.unshift(first);
      } else items.sort((a, b) => rank(a, retries).localeCompare(rank(b, retries)));
    }
  }
  render(res, 'quiz', { ...await assessmentOutline(attempt, scope), currentScope: scope, moduleTitle: module?.title, timed, blocked: limited || timed && remaining === 0, blockedReason: limited ? 'Assessment submission limit reached. Review the lessons and contact your faculty for remediation.' : 'Time expired. Your saved answers remain visible; use the restart action below if you have attempts remaining.', title: scope === 'pretest' ? 'Course pre-test' : final ? 'Final assessment' : 'Module quiz', topics, canSubmit, scope, final, pretest: scope === 'pretest', draftRevision: draft.revision, draftUrl: `/student/learn/${attempt.id}/draft/${scope}`, remainingSeconds: remaining, challenge: issueChallenge(req.user.id, `${attempt.id}:${scope}`) });
};
export const saveDraft = async (req, res) => {
  let saved;
  await sequelize.transaction(async transaction => {
    const a = await ownedAttempt(req, transaction); if (!a || a.status === 'completed') error('Attempt unavailable.', 404);
    const scope = req.params.scope; if (!topicDraftAllowed(a, scope)) error('Assessment locked.', 403);
    const draft = await draftFor(req.user.id, a, scope, transaction, !req.query.topic); checkQuizLimits(a, scope, draft);
    if (Number(req.body.revision) !== draft.revision) error('Answers changed in another tab. Reload before continuing.', 409);
    const questions = scopeQuestions(a, scope);
    let answers = validateDraftAnswers(questions, req.body.answers);
    const moduleIndex = a.snapshot.modules.findIndex(module => module.id === scope);
    if (moduleIndex >= 0) {
      const outline = moduleOutline(a, a.snapshot.modules[moduleIndex], moduleIndex, draft);
      const topics = outline.lessons.filter(topic => topic.lectureDone && (!req.query.topic || topic.id === req.query.topic));
      if ((req.query.topic && !topics.length) ||
          Object.keys(answers).some(id => !topics.some(topic => topic.questions.some(question => question.id === id)))) {
        error('Topic unavailable.', 403);
      }
      if (req.query.topic) answers = { ...draft.answers, ...answers };
    }
    await draft.update({ answers, revision: draft.revision + 1 }, { transaction }); saved = { saved: true, revision: draft.revision };
  }); res.json(saved);
};
export const restartQuiz = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const a = await ownedAttempt(req, transaction), scope = req.params.scope; if (!a || a.status === 'completed' || !topicDraftAllowed(a, scope)) error('Assessment unavailable.', 403);
    const d = await draftFor(req.user.id, a, scope, transaction), p = a.snapshot.policy || {};
    if (!p.quizMinutes || !d.startedAt || Date.now() - new Date(d.startedAt) <= p.quizMinutes * 60000) error('Only an expired timed assessment can be restarted.');
    const history = [...a.quizAttempts, { scope, finalAssessmentRevision: a.snapshot.finalAssessmentRevision, score: 0, expired: true, seconds: p.quizMinutes * 60, at: new Date().toISOString() }];
    if (p.attemptLimit && assessmentSubmissions(a, scope).length + 1 >= p.attemptLimit) error('Attempt limit reached. Contact your faculty.', 403);
    await a.update({ quizAttempts: history }, { transaction }); const module = a.snapshot.modules.find(item => item.id === scope);
    const startedAt = module && !moduleProgress(a, module).answered ? null : new Date();
    await d.update({ startedAt, answers: {}, revision: d.revision + 1 }, { transaction });
  }); res.redirect(`/student/learn/${req.params.id}/${req.params.scope === 'final' ? 'final' : 'quiz/' + req.params.scope}`);
};
export const retakeModule = async (req, res) => {
  const destination = await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction);
    const module = attempt && selectedMaterialModule(attempt, req.params.moduleId);
    if (!module || attempt.status !== 'ongoing') error('Module unavailable.', 404);
    const { retakeUrl, retakeCount } = moduleProgress(attempt, module);
    if (!retakeUrl) error('No retake is available for this module.', 403);

    const topicIds = new Set(module.lessons.map(lesson => lesson.id));
    const quizScores = { ...attempt.quizScores, [`retake:${module.id}`]: retakeCount + 1 };
    delete quizScores[module.id];
    delete quizScores[`read:${module.id}`];
    await attempt.update({
      quizScores,
      completedLessons: attempt.completedLessons.filter(id => !topicIds.has(id)),
      lastLessonId: module.lessons[0]?.id ?? null,
      lastActivityAt: new Date()
    }, { transaction });
    await QuizDraft.destroy({ where: { attemptId: attempt.id, scope: module.id }, transaction });
    return moduleStartHref(attempt, module.id) || `/student/learn/${attempt.id}?module=${encodeURIComponent(module.id)}`;
  });
  delete req.session.careerAi;
  res.redirect(destination);
};
export const submitQuiz = async (req, res) => {
  const scope = req.params.moduleId || 'final', final = scope === 'final', pretest = scope === 'pretest';
  const nonce = checkChallenge(req.body.challenge, req.user.id, `${req.params.id}:${scope}`);
  await sequelize.transaction(async transaction => {
    const attempt = await ownedAttempt(req, transaction); if (!attempt) error('Attempt not found.', 404);
    if (attempt.status === 'completed' || attempt.quizAttempts.some(a => a.nonce === nonce)) return;
    if (final && finalFeedbackAvailable(attempt)) error('You have already passed this final assessment.', 409);
    if (!scopeAllowed(attempt, scope)) error('Requirements are incomplete.', 403);
    const moduleIndex = attempt.snapshot.modules.findIndex(module => module.id === scope);
    if (moduleIndex >= 0) {
      if (moduleProgress(attempt, attempt.snapshot.modules[moduleIndex]).failed) error('Start the module retake first.', 403);
      const saved = await QuizDraft.findOne({ where: { attemptId: attempt.id, scope }, transaction });
      if (!moduleOutline(attempt, attempt.snapshot.modules[moduleIndex], moduleIndex, saved).quizAvailable) {
        error('Finish every topic and save all topic answers before submitting.', 403);
      }
    }
    const draft = await draftFor(req.user.id, attempt, scope, transaction); checkQuizLimits(attempt, scope, draft);
    const result = grade(scopeQuestions(attempt, scope), req.body.answers || {}), passed = result.score >= attempt.snapshot.passingScore;
    const update = { quizAttempts: [...attempt.quizAttempts, { nonce, scope, finalAssessmentRevision: attempt.snapshot.finalAssessmentRevision, score: result.score, scores: result.scores, correct: result.correct, total: result.total, nextDraftRevision: draft.revision + 1, seconds: Math.max(0, Math.floor((Date.now() - new Date(draft.startedAt)) / 1000)), at: new Date().toISOString() }], lastActivityAt: new Date() };
    if (final) update.finalScore = result.score;
    else if (!pretest) update.quizScores = { ...attempt.quizScores, [scope]: Math.max(attempt.quizScores[scope] || 0, result.score) };
    await attempt.update(update, { transaction });
    await draft.destroy({ transaction });
    if (!final && !pretest) await removeStartedBookmark(attempt, scope, transaction);
    if (!final && !pretest && passed) {
      const module = attempt.snapshot.modules.find(item => item.id === scope);
      if (Array.isArray(module?.skills)) await ensureCompletionCredential(attempt, req.user, result.score, transaction, module);
    }
    if (final && passed) await finalizeAttempt(attempt, req.user, transaction);
  });
  delete req.session.careerAi;
  res.redirect(`/student/learn/${req.params.id}/result/${nonce}`);
};
export const quizResult = async (req, res) => {
  const attempt = await CourseAttempt.findOne({ where: { id: req.params.id, userId: req.user.id } });
  const result = attempt?.quizAttempts.find(item => item.nonce === req.params.nonce && !item.expired);
  if (!result) return fail(res, 'Assessment result not found.', 404);
  const { scope } = result;
  const final = scope === 'final', pretest = scope === 'pretest';
  const passed = result.score >= attempt.snapshot.passingScore;
  const completed = attempt.status === 'completed';
  const limit = attempt.snapshot.policy?.attemptLimit;
  const current = completed ? attempt : await ownedAttempt(req);
  const submitted = current ? assessmentSubmissions(current, scope) : [];
  const latestResult = submitted.at(-1)?.nonce === result.nonce;
  const courseUrl = `/student/learn/${attempt.id}`;
  const module = attempt.snapshot.modules.find(item => item.id === scope);
  const retakeUrl = latestResult && module && current && moduleProgress(current, module).retakeUrl;
  const retry = Boolean(retakeUrl || final && !passed && !completed && latestResult &&
    (!limit || submitted.length < limit) && scopeAllowed(current, scope));
  const moduleUrl = module && `/student/learn/${attempt.id}?module=${encodeURIComponent(module.id)}`;
  render(res, 'quiz-result', { ...(current ? await assessmentOutline(current, scope) : {}), moduleTitle: module?.title,
    title: pretest ? 'Pre-test result' : final ? 'Final assessment result' : 'Module quiz result',
    courseTitle: attempt.snapshot.title, passingScore: attempt.snapshot.passingScore,
    result, passed, pretest, final, completed, retry, retakeUrl, courseUrl,
    continueUrl: moduleUrl || (pretest ? resumeHref(plain(current || attempt)) : courseUrl),
    retryUrl: final ? `${courseUrl}/final` : `${courseUrl}/quiz/${scope}`
  });
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
async function careerProvider() {
  const course = await courseAiConfiguration();
  const gemini = aiConfiguration();
  if (course.ready && course.provider === 'groq') return course;
  return { ...gemini, provider: 'gemini', label: 'Gemini' };
}
export const careers = async (req, res) => {
  if (req.query.find === 'matches') req.session.careerMatchSearchUserId = req.user.id;
  const evidence = studentCareerEvidence(await attemptsFor(req.user.id), await activeCareerTracks());
  const { learning } = evidence;
  const fingerprint = careerFingerprint(evidence, learning);
  if (req.session.careerAi?.fingerprint !== fingerprint) delete req.session.careerAi;
  const hasPassedModule = evidence.completed.length > 0;
  const showCareerMatches = hasPassedModule && req.session.careerMatchSearchUserId === req.user.id;
  const provider = hasPassedModule ? await careerProvider() : {};
  render(res, 'careers', { title: 'Find My Career', hasPassedModule, showCareerMatches, tracks: evidence.tracks,
    passedModules: evidence.completed, developingCourses: evidence.developing,
    aiReady: provider.ready, aiProvider: provider.provider, aiProviderLabel: provider.label, ai: req.session.careerAi });
};
export const generateGuidance = async (req, res) => {
  const json = req.get('accept')?.includes('application/json');
  const reject = (message, status = 400) => {
    if (json) return res.status(status).json({ ok: false, message });
    req.flash('error_msg', message);
    return res.redirect('/student/careers');
  };
  if (req.body.consent !== 'yes') return reject('Confirm permission to share your anonymised learning evidence.');
  try {
    const evidence = studentCareerEvidence(await attemptsFor(req.user.id), await activeCareerTracks());
    if (!evidence.completed.length) return reject('Pass at least one module before finding career matches.');
    if (!evidence.tracks.length) return reject('Your passed modules do not yet have a scored competency linked to a configured pathway.');
    const { learning } = evidence;
    const provider = await careerProvider();
    if ((req.body.provider || 'gemini') !== provider.provider) return reject('The AI provider changed. Reopen Career Matches and confirm the new provider.', 409);
    const ai = await explainCareer(evidence, learning, provider, { moduleOnly: true });
    if (!ai) return reject('AI is not configured. Ask Admin to configure the provider.', 503);
    req.session.careerAi = { ...ai, generatedAt: date(new Date()), fingerprint: careerFingerprint(evidence, learning) };
    req.session.careerMatchSearchUserId = req.user.id;
    if (json) return res.json({ ok: true, redirect: '/student/careers#ai-results' });
    res.redirect('/student/careers#ai-results');
  } catch (error) {
    return reject(error.code ? error.message : 'AI guidance is temporarily unavailable. Your rule-based pathways remain available.', error.status || 503);
  }
};

export const achievements = async (req, res) => {
  const allAttempts = await attemptsFor(req.user.id);
  const completed = allAttempts.filter(a => a.status === 'completed').sort((a,b) => new Date(a.completedAt) - new Date(b.completedAt));
  const existing = await Credential.findAll({ where: { userId: req.user.id, moduleId: '' }, attributes: ['attemptId'] });
  const issuedAttempts = new Set(existing.map(row => Number(row.attemptId)));
  for (const attempt of completed) if (attempt.snapshot.certificateEnabled !== false && !issuedAttempts.has(Number(attempt.id))) await ensureCompletionCredential(attempt, req.user);
  const rows = await Credential.findAll({ where: { userId: req.user.id, revoked: false }, order: [['issuedAt', 'DESC']] });
  const groups = [...new Set(completed.map(a => a.courseId))].map(courseId => { const all = completed.filter(a => a.courseId === courseId); return { title: all.at(-1).snapshot.title, first: date(all[0].completedAt), latest: date(all.at(-1).completedAt), completions: all.length, repeats: Math.max(0,all.length - 1), best: Math.max(...all.map(a => a.finalScore)), latestScore: all.at(-1).finalScore }; });
  const pendingAwards = completed.filter(attempt => !attempt.snapshot.modules.some(module => Array.isArray(module.skills)) && attempt.snapshot.certificateEnabled !== false && !rows.some(row => row.attemptId === attempt.id)).map(attempt => ({ title: attempt.snapshot.title, date: date(attempt.completedAt) }));
  render(res, 'achievements', { pendingAwards, completionHistory: groups, title: 'My achievements', credentials: rows.map(c => ({ ...plain(c), date: date(c.issuedAt), skills: c.moduleId ? c.skills : credentialSkills(completed.find(attempt => Number(attempt.id) === Number(c.attemptId))?.snapshot), starsText: '★'.repeat(c.stars) })) });
};
function credentialSkills(snapshot) {
  const skills = [...new Set((snapshot?.modules || []).flatMap(module => module.skills || []))];
  if (skills.length) return skills;
  return Array.isArray(snapshot?.competencyAreas) && snapshot.competencyAreas.length
    ? snapshot.competencyAreas
    : [snapshot?.domain].filter(Boolean);
}
async function ownedCredential(req) {
  return Credential.findOne({ where: { id: req.params.id, userId: req.user.id, revoked: false } });
}
export const certificate = async (req, res) => {
  const c = await ownedCredential(req); if (!c) return fail(res, 'Certificate not found.', 404);
  const attempt = await CourseAttempt.findByPk(c.attemptId);
  const request = attempt && await CredentialRequest.findOne({ where: { courseId: attempt.courseId, status: 'approved' } });
  const facultyAccount = await User.findByPk(attempt?.snapshot?.ownerId || request?.facultyId || (await Course.findByPk(attempt?.courseId))?.ownerId);
  const signatureImage = (facultyAccount && await profileFacultySignature(facultyAccount.id)) || c.facultySignature || request?.facultySignature || '';
  const facultyName = c.facultyName || facultyAccount?.name || 'Course Faculty';
  const facultyPosition = c.facultyPosition || facultyAccount?.facultyPosition || 'Course Faculty';
  const logos = await Promise.all([
    readFile(new URL('../public/images/certificates/minsu-seal.png', import.meta.url)),
    readFile(new URL('../public/images/certificates/cbm-logo.png', import.meta.url)),
    readFile(new URL('../public/images/certificates/cts-logo.png', import.meta.url)),
  ]);
  const institution = await setting('institutionName', 'MinSU Bongabong Campus');
  const footer = await setting('certificateFooter', 'BSTM CareerBridge · Verified course completion');
  const url = `${appUrl}/verify/${c.id}`;
  const qr = await QRCode.toBuffer(url, { width: 90, margin: 1 });
  res.set('Content-Type', 'application/pdf'); res.set('Content-Disposition', `${req.query.view === '1' ? 'inline' : 'attachment'}; filename="CareerBridge-${c.id}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 25 });
  doc.on('error', () => res.end()); doc.pipe(res);
  doc.rect(25, 25, 792, 545).lineWidth(2).stroke('#007042');
  const brand = await readFile(new URL('../public/images/careerbridge_brand_logo.png', import.meta.url));
  doc.image(brand, 55, 48, { fit: [130, 65] });
  const logoX = [310, 391, 472];
  logos.forEach((logo, i) => doc.image(logo, logoX[i], 62, { fit: [58, 58], align: 'center', valign: 'center' }));
  doc.fillColor('#172533').fontSize(11).text(institution, 55, 124, { width: 730, align: 'center' });
  doc.fillColor('#007042').fontSize(28).text('Certificate of Completion', 55, 152, { width: 730, align: 'center' });
  doc.fillColor('#172533').fontSize(12).text('This certifies that', 55, 206, { width: 730, align: 'center' });
  const fitted = (value, y, size, min, height) => { value = String(value || ''); while (size > min && doc.widthOfString(value, { fontSize: size }) > 700) size--; let fittedValue = value; while (fittedValue.length > 1 && doc.widthOfString(fittedValue, { fontSize: size }) > 700) fittedValue = `${fittedValue.slice(0, -2)}…`; doc.fontSize(size).text(fittedValue, 70, y, { width: 702, height, align: 'center', lineBreak: false }); };
  fitted(c.recipientName, 232, 26, 16, 46);
  doc.fontSize(12).text(c.moduleId ? 'for successfully completing the module' : 'for successfully completing the course', 55, 292, { width: 730, align: 'center' });
  fitted(c.moduleTitle || c.courseTitle, 316, 23, 15, 48);
  doc.fillColor('#64748b').fontSize(8).text(footer, 75, 374, { width: 690, height: 22, align: 'center' });
  doc.moveTo(65, 425).lineTo(777, 425).lineWidth(0.6).stroke('#cbd5e1');
  if (signatureImage) {
    try {
      doc.image(Buffer.from(String(signatureImage).split(',').pop(), 'base64'), 65, 448, { fit: [150, 53], valign: 'center' });
    } catch { /* Older credentials can contain an unreadable signature image. */ }
  }
  doc.fillColor('#172533').fontSize(10).text(facultyName, 65, 506, { width: 225, height: 15, ellipsis: true });
  doc.fontSize(9).text(facultyPosition, 65, 522, { width: 225, height: 16, ellipsis: true });
  doc.image(qr, (doc.page.width - 64) / 2, 470, { width: 64, link: url });
  doc.fillColor('#64748b').fontSize(8).text(`Cert ID: ${c.id}`, 271, 542, { width: 300, align: 'center' });
  doc.fillColor('#172533').fontSize(10).text(date(attempt?.completedAt || c.issuedAt), 552, 506, { width: 225, align: 'right' });
  doc.fontSize(9).text('Completion Date', 552, 522, { width: 225, align: 'right' });
  doc.end();
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
  const attempt = c.revoked ? null : await CourseAttempt.findByPk(c.attemptId);
  res.render('verify', { title: 'Verify credential', credential: { ...plain(c), date: date(c.issuedAt), skills: c.moduleId ? c.skills : credentialSkills(attempt?.snapshot) } });
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
  if (!a || !(scope === 'final' ? finalFeedbackAvailable(a) : assessmentSubmissions(a, scope).some(result => !result.expired)) || !scopeQuestions(a, scope).length) return fail(res, 'Submit this assessment before reviewing its answers.',403);
  const module = selectedMaterialModule(a, scope);
  if (module) {
    const progress = moduleProgress(a, module);
    if (progress.retakeCount && !progress.answered) return fail(res, 'Submit your module retake before reviewing its answers.', 403);
  }
  if (scope !== 'final' && a.snapshot.policy?.feedbackTiming === 'after-completion' && a.status !== 'completed') return fail(res,'Answer explanations are released after course completion.',403);
  render(res,'review',{ title:'Assessment feedback', ...await assessmentOutline(a, scope), questions: scopeQuestions(a,scope).map(q => ({ prompt:q.prompt, answer:q.options[q.answer], explanation:q.explanation, sourceReference:q.sourceReference })) });
};

