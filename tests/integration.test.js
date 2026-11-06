import {signatureFixture} from './signatureFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
const { sequelize, User, Course, CourseAttempt, StudentProfile, Credential, Assessment } = await import('../models/learningModels.js');
const { starterCourses } = await import('../data/starterCourses.js');
const {CredentialRequest}=await import('../models/portalModels.js');
const {Setting}=await import('../models/adminModels.js');
const { default: app, startServer, closeResources } = await import('../index.js');
const { seedAdministration } = await import('../services/accounts.js');
const { issueChallenge } = await import('../services/learning.js');
let server, base;
class Browser {
  cookie = '';
  csrf = '';
  async get(path) {
    const r = await fetch(base + path, { headers: { cookie: this.cookie }, redirect: 'manual' });
    const cookie = r.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    const html = await r.text();
    const token = html.match(/name="_csrf" value="([^"]+)"/); if (token) this.csrf = token[1];
    return { r, html };
  }
  async post(path, body = {}, csrf = this.csrf) {
    const r = await fetch(base + path, { method: 'POST', headers: { cookie: this.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, _csrf: csrf }), redirect: 'manual' });
    const cookie = r.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    return r;
  }
}
await test('student HTTP workflow, ownership, scoring, retakes and downloads', async t => {
  await sequelize.sync({ force: true });
  await seedAdministration(); // Isolated in-memory test database only.
  const faculty = await User.create({ name: 'Test Faculty', email: 'course-author@example.test', facultyId: 'FAC-TEST-01', role: 'faculty', approvalStatus: 'approved' });
  for (let i = 0; i < starterCourses.length; i++) await Course.create({ ...starterCourses[i], ownerId: faculty.id, published: true, starter: true, awardsApproved: true, slug: `test-course-${i + 1}` });
  const signature='data:image/png;base64,'+(await signatureFixture()).toString('base64');
  await Setting.upsert({key:'adminSignature',value:signature});
  for(const course of await Course.findAll())await CredentialRequest.create({courseId:course.id,facultyId:faculty.id,status:'approved',facultySignature:signature});
  server = await startServer(0); base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(health.headers.get('set-cookie'), null);
    const student = new Browser();
    let response = await student.get('/student');
    assert.equal(response.r.status, 302); assert.equal(response.r.headers.get('location'), '/login');
    await student.get('/register');
    assert.equal((await student.post('/register', {}, 'bad')).status, 403);
    const signup = { name: 'Student One', email: 'one@example.com', student_id: '2026-001', section: 'BSTM 4-1', gender: 'Male', password: 'password12345', confirm_password: 'password12345', role: 'admin' };
    response = await student.post('/register', signup);
    assert.equal(response.headers.get('location'), '/student/profile');
    const user = await User.findOne({ where: { email: 'one@example.com' } });
    assert.equal(user.role, 'student'); assert.equal(user.studentId, '2026-001'); assert.equal(user.section, 'BSTM 4-1');
    await student.get('/student/profile');
    response = await student.post('/student/courses/1/enroll');
    assert.equal(response.headers.get('location'), '/student/profile');
    const profile = { name: 'Student One', email: 'one@example.com', studentId: '2026-001', section: 'BSTM 4-1', gender: 'Male', yearLevel: 'Graduating', academicY