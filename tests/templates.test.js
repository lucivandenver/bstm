import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import hbs from 'hbs';
import { starterCourses } from '../data/starterCourses.js';
import { publicQuestions } from '../services/learning.js';
hbs.registerHelper('areaLabels', (areas, primary) => Array.isArray(areas) && areas.length ? areas.join(' • ') : primary);
hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('selected', (a, b) => a === b ? 'selected' : '');
for (const file of fs.readdirSync('views/partials')) {
  if (file.endsWith('.xian')) hbs.registerPartial(file.replace('.xian', ''), fs.readFileSync(`views/partials/${file}`, 'utf8'));
}
const render = (path, data) => new Promise((resolve, reject) => hbs.__express(path, { ...data, settings: { views: `${process.cwd()}/views` } }, (err, html) => err ? reject(err) : resolve(html)));
const course = starterCourses[0];
const data = { title: 'Student test', csrf: 'test-token', currentUser: { name: '<script>alert(1)</script>', email: 'student@example.com' },
  course, attempt: { id: 1, title: course.title, snapshot: course, percent: 50, done: 3, total: 7 },
  selected: course.modules[0].lessons[0], modules: course.modules.map(m => ({ ...m, lessons: m.lessons.map(lesson => ({ ...lesson, unlocked: true })), quizAvailable: true })),
  questions: publicQuestions(course.questions), domains: [], tracks: [], profile: {}, notifications: [] };
test('all student screens render with empty and populated account data', async () => {
  for (const file of fs.readdirSync('views/student')) {
    if (!file.endsWith('.xian')) continue;
    const html = await render(`views/student/${file}`, data);
    assert.ok(html.includes('<html'), file);
    assert.ok(!html.includes('<script>alert(1)</script>'), `${file} should escape names`);
    assert.ok(!html.includes('[object Object]'), file);
  }
});
test('learning links contain correct attempt and lesson IDs', async () => {
  const html = await render('views/student/learn.xian', data);
  assert.ok(html.includes('/student/learn/1?lesson=traveller'));
  assert.ok(html.includes('/student/learn/1/quiz/planning'));
});
test('quiz pages contain no answer keys or explanations', async () => {
  const html = await render('views/student/quiz.xian', { ...data, scope: 'planning', topics: [{ questions: data.questions }] });
  assert.ok(html.includes('name="answers[t1]"'));
  assert.ok(!html.includes(course.questions[0].explanation));
  assert.ok(!html.includes('correctAnswer'));
});

await test('student awards group one badge per course and list only earned module skills', async () => {
  const html = await render('views/student/achievements.xian', { ...data, awardGroups: [
    { courseId: 7, title: 'Tourism systems', earnedModules: [{ moduleTitle: 'Booking', score: 90, skills: ['Reservation workflow'] }], certificates: [{ id: 'earned', moduleTitle: 'Booking', score: 90 }] },
    { courseId: 8, title: 'Tour guiding', earnedModules: [], certificates: [] }
  ] });
  assert.equal((html.match(/data-open-award="course-badge-/g) || []).length, 2);
  assert.match(html, /Reservation workflow/);
  assert.match(html, /course-badge-7/); assert.match(html, /course-badge-8/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
});
await test('faculty announcement selection offers search, section and gender with checkboxes', async () => {
  const html = await render('views/faculty/announcements.xian', { ...data, sections: ['BSTM 4-1'], students: [{ id: 1, name: 'Student A', studentId: 'ID1', section: 'BSTM 4-1', gender: 'Female' }] });
  for (const attribute of ['data-student-search', 'data-student-section', 'data-student-gender', 'data-select-results', 'data-clear-recipients']) assert.ok(html.includes(attribute));
  assert.match(html, /type="checkbox" name="studentIds" value="1"/);
  assert.doesNotMatch(html, /multiple size|Hold Ctrl/);
});
