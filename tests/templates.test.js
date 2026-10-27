import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import hbs from 'hbs';
import { starterCourses } from '../data/starterCourses.js';
import { publicQuestions } from '../services/learning.js';
hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('selected', (a, b) => a === b ? 'selected' : '');
for (const file of fs.readdirSync('views/partials')) {
  if (file.endsWith('.xian')) hbs.registerPartial(file.replace('.xian', ''), fs.readFileSync(`views/partials/${file}`, 'utf8'));
}
const render = (path, data) => new Promise((resolve, reject) => hbs.__express(path, { ...data, settings: { views: `${process.cwd()}/views` } }, (err, html) => err ? reject(err) : resolve(html)));
const course = starterCourses[0];
const data = { title: 'Student test', csrf: 'test-token', currentUser: { name: '<script>alert(1)</script>', email: 'student@example.com' },
  course, attempt: { id: 1, title: course.title, snapshot: course, percent: 50, done: 3, total: 7 },
  selected: course.modules[0].lessons[0], modules: course.modules.map(m => ({ ...m, available: true, quizAvailable: true })),
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
  const html = await render('views/student/quiz.xian', { ...data, scope: 'planning' });
  assert.ok(html.includes('name="answers[t1]"'));
  assert.ok(!html.includes(course.questions[0].explanation));
  assert.ok(!html.includes('correctAnswer'));
});
