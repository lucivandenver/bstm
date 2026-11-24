import test from 'node:test';
import assert from 'node:assert/strict';
import { browser } from './httpHelpers.js';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
process.env.ADMIN_INITIAL_PASSWORD = 'DummyAnalyticsAdminPass!';
const { sequelize, User, Course, CourseAttempt } = await import('../models/learningModels.js');
const { AuditLog, Section } = await import('../models/adminModels.js');
const { CourseAssignment, CourseRevision, QuizDraft } = await import('../models/portalModels.js');
const { bootstrapAdmin, ownerEmail } = await import('../services/accounts.js');
const { dashboardPeriod } = await import('../services/dashboardPeriod.js');
const { startServer, closeResources } = await import('../index.js');
const bcrypt = (await import('bcryptjs')).default;

test('date filters use inclusive Philippine dates and reject invalid ranges', () => {
  const now = new Date('2026-11-24T17:30:00Z');
  assert.deepEqual(dashboardPeriod({ period: 'week' }, now), {
    start: '2026-11-19', end: '2026-11-25',
    from: new Date('2026-11-18T16:00:00Z'), through: new Date('2026-11-25T16:00:00Z')
  });
  assert.equal(dashboardPeriod({ period: 'calendar-week' }, now).start, '2026-11-23');
  assert.equal(dashboardPeriod({ period: 'calendar-month' }, now).start, '2026-11-01');
  assert.equal(dashboardPeriod({ period: 'custom', start: '2026-02-30', end: '2026-03-01' }, now), null);
  assert.equal(dashboardPeriod({ period: 'custom', start: '2026-11-25', end: '2026-11-24' }, now), null);
});

test('admin analytics reports real quiz and assignment progress with role and backup access controls', async () => {
  await sequelize.sync({ force: true });
  await bootstrapAdmin();
  const server = await startServer(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const admin = browser(base), faculty = browser(base), student = browser(base), anonymous = browser(base);
    const password = 'AnalyticsFixturePass!';
    const hash = await bcrypt.hash(password, 4);
    const teacher = await User.create({ name: 'Teacher', role: 'faculty', email: 'analytics-teacher@example.com', password: hash, approvalStatus: 'approved', active: true });
    const section = await Section.create({ name: 'Analytics Section' });
    const learners = await Promise.all(['Completed', 'Answering', 'In progress', 'Not started', 'Failed', 'Failed after retake', 'Retaking'].map((name, index) =>
      User.create({ name, role: 'student', email: `analytics-student-${index}@example.com`, password: hash, section: section.name, active: true, approvalStatus: 'approved' })
    ));
    const course = await Course.create({ title: 'Faculty analytics course', slug: 'faculty-analytics-fixture', published: true, ownerId: teacher.id, modules: [{ id: 'module', title: 'Module one' }] });
    const otherTeacher = await User.create({ name: 'Other teacher', role: 'faculty', email: 'other-teacher@example.com' });
    const oldDate = new Date('2025-06-02T16:00:00Z');
    const other = await Course.create({
      title: 'Other analytics course', slug: 'other-analytics-fixture', published: true, ownerId: otherTeacher.id, createdAt: oldDate
    });
    await CourseRevision.create({ courseId: other.id, action: 'admin-published', createdAt: oldDate });
    await CourseRevision.create({ courseId: course.id, action: 'admin-published' });
    const olderLearner = await User.create({ name: 'Older learner', email: 'older-learner@example.com', createdAt: oldDate });
    await CourseAttempt.create({ courseId: other.id, userId: olderLearner.id, attemptNumber: 1, createdAt: oldDate,
      snapshot: { modules: [{ id: 'past', title: 'Past module' }], passingScore: 75 },
      quizAttempts: [{ scope: 'past', score: 100, at: oldDate.toISOString() }], completedAt: oldDate
    });
    await CourseAssignment.create({ courseId: course.id, sectionId: section.id, facultyId: teacher.id });
    const snapshot = { modules: [{ id: 'module' }], passingScore: 75 };
    const at = new Date().toISOString();
    await CourseAttempt.create({ userId: learners[0].id, courseId: course.id, attemptNumber: 1, snapshot, quizAttempts: [{ scope: 'pretest', score: 50, at }, { scope: 'module', score: 100, at }], quizScores: { module: 100 }, completedAt: new Date() });
    const answering = await CourseAttempt.create({ userId: learners[1].id, courseId: course.id, attemptNumber: 1, snapshot });
    await QuizDraft.create({ userId: learners[1].id, attemptId: answering.id, scope: 'module', answers: { question: 0 } });
    await CourseAttempt.create({ userId: learners[2].id, courseId: course.id, attemptNumber: 1, snapshot });

    for (const index of [4, 5, 6]) {
      const hasRetake = index !== 4;
      const scored = index !== 6;
      const attempt = await CourseAttempt.create({
        userId: learners[index].id, courseId: course.id, attemptNumber: 1, snapshot,
        quizScores: { ...(scored ? { module: 50 } : {}), ...(hasRetake ? { 'retake:module': 1 } : {}) },
        quizAttempts: [{ scope: 'module', score: 50, at }, ...(index === 5 ? [{ scope: 'module', score: 40, at }] : [])]
      });
      if (index === 6) await AuditLog.create({
        actorId: learners[index].id, action: 'module.retake_started', targetType: 'attempt',
        targetId: String(attempt.id), details: { moduleId: 'module' }
      });
    }

    assert.equal((await anonymous.get('/admin/analytics')).location, '/login');
    await admin.login(ownerEmail(), process.env.ADMIN_INITIAL_PASSWORD);
    await faculty.login(teacher.email, password);
    await student.login(learners[0].email, password);
    const dashboard = (await admin.get('/admin')).html;
    assert.match(dashboard, /Module progress by course/);
    assert.doesNotMatch(dashboard, /Export Database/);
    assert.match((await admin.get('/admin/maintenance')).html, /Export Database \(\.sql\)/);
    assert.doesNotMatch((await faculty.get('/faculty')).html, /Learning analytics|Export Database/);
    assert.equal((await faculty.get('/faculty/analytics')).status, 404);
    assert.equal((await faculty.get('/admin/analytics')).status, 403);
    assert.equal((await student.get('/faculty/analytics')).status, 403);
    assert.equal((await faculty.post('/admin/maintenance/backup')).status, 403);
    assert.equal((await student.post('/admin/maintenance/backup')).status, 403);
    assert.equal((await admin.post('/admin/maintenance/backup', {}, 'bad')).status, 403);
    assert.equal((await admin.get('/admin/analytics?period=invalid')).status, 400);
    assert.equal((await admin.get('/vendor/chart.umd.js')).status, 200);

    const adminStats = JSON.parse((await admin.get('/admin/analytics?period=day')).html);
    assert.deepEqual(adminStats.status, { notStarted: 1, answering: 1, inProgress: 4, completed: 2 });
    assert.deepEqual(adminStats.totals, { published: 1, started: 6, submitted: 5, retakes: 1, completed: 1 });
    assert.deepEqual(adminStats.courses.find(row => row.id === course.id).modules, [{
      title: 'Module one', total: 7, passed: 1, failedWithoutRetake: 1, failedAfterRetake: 1, ongoing: 2,
      notStarted: 2, historyUnavailable: 0, retook: 2, retookInPeriod: 1
    }]);
    assert.ok(adminStats.courses.some(row => row.title === 'Other analytics course'));
    assert.equal(adminStats.trend.reduce((sum, row) => sum + row.submitted, 0), adminStats.totals.submitted);
    const scoped = JSON.parse((await admin.get(`/admin/analytics?period=day&facultyId=${teacher.id}`)).html);
    assert.deepEqual(scoped.selectedFaculty, { id: teacher.id, name: 'Teacher' });
    assert.deepEqual(scoped.courses.map(row => row.id), [course.id]);
    assert.equal(scoped.status.completed, 1);
    assert.deepEqual(scoped.totals, adminStats.totals);
    const past = JSON.parse((await admin.get(`/admin/analytics?period=custom&start=2025-06-03&end=2025-06-03&facultyId=${otherTeacher.id}`)).html);
    assert.deepEqual(past.totals, { published: 1, started: 1, submitted: 1, retakes: 0, completed: 1 });
    assert.equal(past.courses[0].modules[0].passed, 1);
    const then = JSON.parse((await admin.get(`/admin/analytics?period=custom&start=2025-06-02&end=2025-06-02&facultyId=${otherTeacher.id}`)).html);
    assert.equal(then.totals.submitted, 0);
    assert.deepEqual(then.courses, []);
    assert.equal((await admin.get(`/admin/analytics?facultyId=${learners[0].id}`)).status, 400);
    const prior = JSON.parse((await admin.get('/admin/analytics?period=custom&start=2000-01-01&end=2000-01-02')).html);
    assert.equal(prior.trend.length, 2);
    assert.equal(prior.courses.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closeResources();
  }
});

test('historical module statuses exclude future results and flag undated history', async () => {
  const { moduleActivity, summarizeModules } = await import('../services/moduleAnalytics.js');
  const range = dashboardPeriod({ period: 'custom', start: '2025-06-01', end: '2025-06-02' }, new Date('2025-07-01'));
  const module = { id: 'quiz', title: 'Module' };
  const earlier = '2025-06-01T02:00:00Z';
  const later = '2025-06-03T00:00:00Z';
  const { saved, restarts } = moduleActivity([], [
    { targetId: '3', details: { moduleId: module.id }, createdAt: '2025-06-02T02:00:00Z' }
  ]);
  const attempts = [1, 2, 3].map(id => ({
    id, userId: id, updatedAt: later, snapshot: { modules: [module], passingScore: 75 },
    quizScores: id === 1 ? { quiz: 100 } : {},
    quizAttempts: id === 2 ? [] : [{ scope: 'quiz', score: 50, at: earlier }, { scope: 'quiz', score: 100, at: later }]
  }));
  const [row] = summarizeModules({
    course: { modules: [module], updatedAt: earlier },
    learners: new Map([[4, { status: 'notStarted' }]])
  }, range, saved, restarts, attempts);
  assert.deepEqual(row, {
    title: 'Module', total: 4, passed: 0, failedWithoutRetake: 1, failedAfterRetake: 0,
    ongoing: 1, notStarted: 1, historyUnavailable: 1, retook: 1, retookInPeriod: 1
  });
});
