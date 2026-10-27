import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
const { sequelize, User, Course, CourseAttempt, StudentProfile, Credential, Assessment } = await import('../models/learningModels.js');
const { starterCourses } = await import('../data/starterCourses.js');
const { default: app, startServer, closeResources } = await import('../index.js');
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
  await sequelize.sync({ force: true }); // Isolated in-memory test database only.
  for (const c of starterCourses) await Course.create({ ...c, published: true, starter: true });
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
    const signup = { name: 'Student One', email: 'one@example.com', student_id: '2026-001', section: '4-1', password: 'password12345', confirm_password: 'password12345', role: 'admin' };
    response = await student.post('/register', signup);
    assert.equal(response.headers.get('location'), '/student/profile');
    const user = await User.findOne({ where: { email: 'one@example.com' } });
    assert.equal(user.role, 'student'); assert.equal(user.studentId, '2026-001'); assert.equal(user.section, '4-1');
    await student.get('/student/profile');
    response = await student.post('/student/courses/1/enroll');
    assert.equal(response.headers.get('location'), '/student/profile');
    const profile = { name: 'Student One', studentId: '2026-001', section: '4-1', yearLevel: 'Graduating', academicYear: '2026-2027', graduationYear: '2027', ojtStatus: 'Ongoing', ojtHours: '300', careerInterest: 'Travel and tour operations', preferredLocation: 'Philippines' };
    await student.post('/student/profile', profile);
    assert.equal((await StudentProfile.findOne({ where: { userId: user.id } })).complete, true);
    for (const route of ['/student', '/student/profile', '/student/courses', '/student/courses/1', '/student/learning', '/student/assessment', '/student/results', '/student/careers', '/student/achievements', '/student/notifications']) {
      response = await student.get(route); assert.equal(response.r.status, 200, route); assert.ok(!response.html.includes('Something went wrong'), route);
    }
    response = await student.post('/student/courses/1/enroll');
    assert.equal(response.headers.get('location'), '/student/learn/1');
    await student.post('/student/courses/1/enroll');
    assert.equal(await CourseAttempt.count(), 1, 'duplicate enrollment resumes current attempt');
    response = await student.get('/student/learn/1/final'); assert.equal(response.r.status, 403);
    response = await student.get('/student/learn/1?lesson=cost'); assert.equal(response.r.status, 403);
    const other = new Browser(); await other.get('/register');
    await other.post('/register', { ...signup, name: 'Student Two', email: 'two@example.com', student_id: '2026-002' });
    response = await other.get('/student/learn/1'); assert.equal(response.r.status, 404);
    await other.get('/student/profile');
    response = await other.post('/student/learn/1/complete', { lessonId: 'traveller' }); assert.equal(response.status, 404);
    const c = starterCourses[0];
    for (const module of c.modules) {
      for (const lesson of module.lessons) { await student.get('/student/learn/1'); await student.post('/student/learn/1/complete', { lessonId: lesson.id }); }
      const quiz = await student.get(`/student/learn/1/quiz/${module.id}`);
      assert.equal(quiz.r.status, 200);
      assert.ok(!quiz.html.includes(c.questions[0].explanation));
      const challenge = quiz.html.match(/name="challenge" value="([^"]+)"/)[1];
      const answers = Object.fromEntries(c.questions.filter(q => q.moduleId === module.id).map(q => [`answers[${q.id}]`, String(q.answer)]));
      response = await student.post(`/student/learn/1/quiz/${module.id}`, { challenge, ...answers }); assert.equal(response.status, 302);
    }
    const final = await student.get('/student/learn/1/final'); assert.equal(final.r.status, 200);
    const challenge = final.html.match(/name="challenge" value="([^"]+)"/)[1];
    const answers = Object.fromEntries(c.questions.map(q => [`answers[${q.id}]`, String(q.answer)]));
    // A failed final does not issue credentials; retry succeeds later.
    const wrong = Object.fromEntries(c.questions.map(q => [`answers[${q.id}]`, String((q.answer + 1) % q.options.length)]));
    await student.post('/student/learn/1/final', { challenge, ...wrong });
    assert.equal(await Credential.count(), 0);
    const next = await student.get('/student/learn/1/final');
    const nextChallenge = next.html.match(/name="challenge" value="([^"]+)"/)[1];
    await student.post('/student/learn/1/final', { challenge: nextChallenge, ...answers });
    await student.post('/student/learn/1/final', { challenge: nextChallenge, ...answers });
    assert.equal(await Credential.count(), 1, 'double submission must not duplicate credentials');
    const credential = await Credential.findOne();
    assert.equal(credential.score, 100); assert.equal(credential.stars, 3);
    assert.equal((await CourseAttempt.findByPk(1)).status, 'completed');
    for (const route of ['/student/achievements', `/verify/${credential.id}`, '/student/results', '/student/notifications']) {
      const result = await student.get(route); assert.equal(result.r.status, 200, route);
    }
    let download = await fetch(`${base}/student/credentials/${credential.id}/certificate`, { headers: { cookie: student.cookie } });
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.ok(Buffer.from(await download.arrayBuffer()).subarray(0, 4).equals(Buffer.from('%PDF')));
    download = await fetch(`${base}/student/credentials/${credential.id}/badge`, { headers: { cookie: student.cookie } });
    assert.equal(download.status, 200); assert.ok((await download.text()).includes('<svg'));
    response = await other.get(`/student/credentials/${credential.id}/certificate`); assert.equal(response.r.status, 404);
    await student.get('/student/courses/1'); await student.post('/student/courses/1/enroll');
    assert.equal(await CourseAttempt.count(), 2); assert.equal(await Credential.count(), 1);
    assert.equal((await CourseAttempt.findOne({ where: { attemptNumber: 2 } })).completedLessons.length, 0);
    await student.get('/student/assessment');
    const baseline = starterCourses.flatMap(c => c.questions.slice(0, 2));
    await student.post('/student/assessment', { challenge: issueChallenge(user.id, 'baseline'), ...Object.fromEntries(baseline.map(q => [`answers[${q.id}]`, String(q.answer)])) });
    assert.equal(await Assessment.count(), 1);
    response = await student.get('/student/results'); assert.equal(response.r.status, 200);
    response = await student.get('/auth/google'); assert.equal(response.r.status, 302); assert.equal(response.r.headers.get('location'), '/login');
    await student.get('/student/profile'); await student.post('/logout');
    response = await student.get('/student'); assert.equal(response.r.headers.get('location'), '/login');
  } finally { await new Promise(resolve => server.close(resolve)); await closeResources(); }
});
