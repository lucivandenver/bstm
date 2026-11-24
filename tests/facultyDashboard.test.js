import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import bcrypt from 'bcryptjs';
import { browser } from './httpHelpers.js';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
const { sequelize, User, Course, CourseAttempt } = await import('../models/learningModels.js');
const { CourseRevision, CredentialRequest, PracticalSubmission } = await import('../models/portalModels.js');
const { startServer, closeResources } = await import('../index.js');

const early = new Date('2025-06-01T02:00:00Z');
const selected = new Date('2025-06-10T02:00:00Z');
const later = new Date('2025-06-11T02:00:00Z');
const period = '?period=custom&start=2025-06-10&end=2025-06-10';
const statValues = html => Array.from(html.matchAll(/class="stat-card .*?<strong>(.*?)<\/strong>/gs), match => match[1]);
const studentNames = html => Array.from(html.matchAll(/<td><a href="\/faculty\/students\/\d+">([^<]+)<\/a>/g), match => match[1]);

test('faculty date filter updates six cards and both charts, and monitoring groups five students per page', async () => {
  await sequelize.sync({ force: true });
  const server = await startServer(0);
  try {
    const password = 'DummyFacultyDashboardPass!';
    const hash = await bcrypt.hash(password, 4);
    const teacher = await User.create({ role: 'faculty', email: 'teaching@example.com', name: 'Teacher', password: hash });
    const otherTeacher = await User.create({ role: 'faculty', email: 'other@example.com', name: 'Other teacher' });
    const students = [];
    for (let index = 0; index < 8; index++) {
      students.push(await User.create({ role: 'student', email: `progress-${index}@example.com`, name: `Progress fixture ${index}` }));
    }
    const course = await Course.create({ title: 'Current course', slug: 'current-fixture', published: true, ownerId: teacher.id, createdAt: early });
    const olderCourse = await Course.create({ title: 'Earlier course', slug: 'earlier-fixture', published: true, ownerId: teacher.id, createdAt: early });
    const otherCourse = await Course.create({ title: 'Unrelated course', slug: 'unrelated-fixture', published: true, ownerId: otherTeacher.id, createdAt: selected });
    await CourseRevision.create({ courseId: course.id, action: 'admin-published', createdAt: selected });

    const enroll = (student, target, createdAt, extra = {}) => CourseAttempt.create({
      courseId: target.id, userId: student.id, attemptNumber: 1, createdAt, updatedAt: createdAt,
      snapshot: { title: target.title, modules: [{ id: 'module', title: 'Module fixture', lessons: [] }], passingScore: 75 },
      ...extra
    });
    const resumed = await enroll(students[0], course, early, {
      quizAttempts: [{ scope: 'module', score: 50, at: selected.toISOString() }, { scope: 'module', score: 100, at: later.toISOString() }],
      quizScores: { module: 100 }, lastActivityAt: later, completedAt: later, updatedAt: later
    });
    const completed = await enroll(students[1], course, selected, {
      quizAttempts: [{ scope: 'module', score: 100, at: selected.toISOString() }], completedAt: selected
    });
    await enroll(students[2], course, selected);
    await enroll(students[2], olderCourse, selected, { attemptNumber: 2 });
    for (const student of students.slice(3, 6)) await enroll(student, olderCourse, early);
    await enroll(students[6], olderCourse, early, {
      quizAttempts: [{ scope: 'module', score: 90, at: early.toISOString() }], completedAt: early
    });
    const unrelated = await enroll(students[7], otherCourse, selected);
    await Promise.all([
      CredentialRequest.bulkCreate([
        { courseId: course.id, facultyId: teacher.id, facultySignature: 'test', createdAt: selected, updatedAt: selected },
        { courseId: olderCourse.id, facultyId: teacher.id, facultySignature: 'test', createdAt: early, updatedAt: early }
      ]),
      PracticalSubmission.bulkCreate([
        { attemptId: resumed.id, userId: resumed.userId, taskId: 'older', createdAt: early, updatedAt: early },
        { attemptId: completed.id, userId: completed.userId, taskId: 'current', createdAt: selected, updatedAt: selected },
        { attemptId: unrelated.id, userId: unrelated.userId, taskId: 'unrelated', createdAt: selected, updatedAt: selected }
      ])
    ]);

    const base = `http://127.0.0.1:${server.address().port}`;
    const faculty = browser(base);
    assert.equal((await faculty.login(teacher.email, password)).location, '/dashboard');
    const all = await faculty.get('/faculty');
    assert.deepEqual(statValues(all.html), ['7', '2', '2', '4', '38%', '2']);

    const scoped = await faculty.get('/faculty' + period);
    assert.equal(scoped.status, 200);
    assert.match(scoped.html, /value="custom" selected/);
    assert.match(scoped.html, /2025-06-10 · Philippine time/);
    assert.doesNotMatch(scoped.html, /Learning analytics|Unrelated course/);
    assert.deepEqual(statValues(scoped.html), ['2', '1', '1', '2', '25%', '1']);
    assert.match(scoped.html, /1 of 4 full course attempts completed/);
    assert.match(scoped.html, /data-modules-passed="1" data-modules-remaining="3"/);
    assert.match(scoped.html, /<td>Current course<\/td><td>2<\/td>/);
    assert.match(scoped.html, /<td>Earlier course<\/td><td>1<\/td>/);

    const empty = await faculty.get('/faculty?period=custom&start=2025-06-13&end=2025-06-13');
    assert.deepEqual(statValues(empty.html), ['0', '0', '0', '0', '—', '0']);
    assert.match(empty.html, /No active learners in this period/);
    assert.match(empty.html, /No module attempts in this period/);
    assert.equal((await faculty.get('/faculty?period=custom&start=2025-06-12&end=2025-06-10')).status, 400);

    const first = await faculty.get('/faculty/monitoring');
    const second = await faculty.get('/faculty/monitoring?page=2');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.match(first.html, /Students 1–5 of 7/);
    assert.match(second.html, /Students 6–7 of 7/);
    assert.match(first.html, /href="\?page=2" rel="next"/);
    assert.match(second.html, /href="\?page=1" rel="prev"/);
    const firstNames = studentNames(first.html);
    const secondNames = studentNames(second.html);
    assert.equal(new Set(firstNames).size, 5);
    assert.equal(new Set(secondNames).size, 2);
    assert.equal(firstNames.filter(name => name === students[2].name).length, 2);
    assert.ok(!firstNames.some(name => secondNames.includes(name)));
    assert.ok(![...firstNames, ...secondNames].includes(students[7].name));
    assert.deepEqual(studentNames((await faculty.get('/faculty/monitoring?page=999')).html), secondNames);
    assert.deepEqual(studentNames((await faculty.get('/faculty/monitoring?page=invalid')).html), firstNames);

    const workbook = await fetch(base + '/faculty/reports?export=xlsx&page=2', { headers: { cookie: faculty.cookie } });
    assert.equal(workbook.status, 200);
    const zip = await JSZip.loadAsync(await workbook.arrayBuffer());
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    for (const name of [...firstNames, ...secondNames]) assert.ok(xml.includes(name));
    assert.ok(!xml.includes(students[7].name));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closeResources();
  }
});
