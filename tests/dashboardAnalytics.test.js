import test from 'node:test';
import assert from 'node:assert/strict';
import { browser } from './httpHelpers.js';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
process.env.ADMIN_INITIAL_PASSWORD = 'DummyAnalyticsAdminPass!';
const { sequelize, User, Course, CourseAttempt } = await import('../models/learningModels.js');
const { Section } = await import('../models/adminModels.js');
const { CourseAssignment, QuizDraft } = await import('../models/portalModels.js');
const { bootstrapAdmin, ownerEmail } = await import('../services/accounts.js');
const { analyticsRange } = await import('../services/dashboardAnalytics.js');
const { startServer, closeResources } = await import('../index.js');
const bcrypt = (await import('bcryptjs')).default;

test('date filters use inclusive Philippine dates and reject invalid ranges', () => {
  const now = new Date('2026-11-24T17:30:00Z');
  assert.deepEqual(analyticsRange({ period: 'week' }, now), {
    start: '2026-11-19', end: '2026-11-25',
    from: new Date('2026-11-18T16:00:00Z'), through: new Date('2026-11-25T16:00:00Z')
  });
  assert.equal(analyticsRange({ period: 'custom', start: '2026-02-30', end: '2026-03-01' }, now), null);
  assert.equal(analyticsRange({ period: 'custom', start: '2026-11-25', end: '2026-11-24' }, now), null);
});

test('dashboards report real quiz and assignment progress with faculty and backup access controls', async () => {
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
    const learners = await Promise.all(['Completed', 'Answering', 'In progress', 'Not started'].map((name, index) =>
      User.create({ name, role: 'student', email: `analytics-student-${index}@example.com`, password: hash, section: section.name, active: true, approvalStatus: 'approved' })
    ));
    const course = await Course.create({ title: 'Faculty analytics course', slug: 'faculty-analytics-fixture', published: true, ownerId: teacher.id });
    await Course.create({ title: 'Other analytics course', slug: 'other-analytics-fixture', published: true });
    await CourseAssignment.create({ courseId: course.id, sectionId: section.id, facultyId: teacher.id });
    const snapshot = { modules: [{ id: 'module' }], passingScore: 75 };
    const at = new Date().toISOString();
    await CourseAttempt.create({ userId: learners[0].id, courseId: course.id, attemptNumber: 1, snapshot, quizAttempts: [{ scope: 'module', score: 100, at }], quizScores: { module: 100 }, completedAt: new Date() });
    const answering = await CourseAttempt.create({ userId: learners[1].id, courseId: course.id, attemptNumber: 1, snapshot });
    await QuizDraft.create({ userId: learners[1].id, attemptId: answering.id, scope: 'module', answers: { question: 0 } });
    await CourseAttempt.create({ userId: learners[2].id, courseId: course.id, attemptNumber: 1, snapshot });

    assert.equal((await anonymous.get('/admin/analytics')).location, '/login');
    await admin.login(ownerEmail(), process.env.ADMIN_INITIAL_PASSWORD);
    await faculty.login(teacher.email, password);
    await student.login(learners[0].email, password);
    assert.match((await admin.get('/admin')).html, /Export Database \(\.sql\)/);
    assert.match((await faculty.get('/faculty')).html, /Learning analytics/);
    assert.doesNotMatch((await faculty.get('/faculty')).html, /Export Database/);
    assert.equal((await faculty.get('/admin/analytics')).status, 403);
    assert.equal((await student.get('/faculty/analytics')).status, 403);
    assert.equal((await faculty.post('/admin/maintenance/backup')).status, 403);
    assert.equal((await student.post('/admin/maintenance/backup')).status, 403);
    assert.equal((await admin.post('/admin/maintenance/backup', {}, 'bad')).status, 403);
    assert.equal((await admin.get('/admin/analytics?period=invalid')).status, 400);
    assert.equal((await admin.get('/vendor/chart.umd.js')).status, 200);

    const facultyStats = JSON.parse((await faculty.get('/faculty/analytics?period=day')).html);
    assert.deepEqual(facultyStats.status, { notStarted: 1, answering: 1, inProgress: 1, completed: 1 });
    assert.deepEqual(facultyStats.totals, { published: 1, started: 3, submitted: 1, completed: 1 });
    assert.deepEqual(facultyStats.courses.map(row => row.title), [course.title]);
    const adminStats = JSON.parse((await admin.get('/admin/analytics?period=day')).html);
    assert.equal(adminStats.totals.published, facultyStats.totals.published + 1);
    assert.ok(adminStats.courses.some(row => row.title === 'Other analytics course'));
    const prior = JSON.parse((await faculty.get('/faculty/analytics?period=custom&start=2000-01-01&end=2000-01-02')).html);
    assert.equal(prior.trend.length, 2);
    assert.equal(prior.courses.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closeResources();
  }
});
