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
  const { awardGallery } = await import('../services/awardGallery.js');
  const gallery = awardGallery([
    { id: 'earned', attemptId: 1, courseTitle: 'Tourism systems', moduleId: 'm1', moduleTitle: 'Booking', skills: ['Reservation workflow'] },
    { id: 'earned2', attemptId: 2, courseTitle: 'Tour guiding', moduleId: 'm2', moduleTitle: 'Guiding', skills: [] }
  ], [{ id: 1, courseId: 7, snapshot: { modules: [] } }, { id: 2, courseId: 8, snapshot: { modules: [] } }]);
  const html = await render('views/student/achievements.xian', { ...data, gallery });
  assert.equal((html.match(/data-open-award="course-badge-/g) || []).length, 2);
  assert.match(html, /Booking/);
  assert.doesNotMatch(html.match(/<dialog id="course-badge-7"[\s\S]*?<\/dialog>/)[0], /Reservation workflow/);
  assert.match(html, /View &amp; Download/);
  assert.match(html, /View &amp; Share Badge/);
  assert.match(html, /Search by name, course, academy/);
  assert.match(html, /course-badge-7/); assert.match(html, /course-badge-8/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
});
await test('faculty announcement selection offers search, section and gender with checkboxes', async () => {
  const html = await render('views/faculty/announcements.xian', { ...data, sections: ['BSTM 4-1'], students: [{ id: 1, name: 'Student A', studentId: 'ID1', section: 'BSTM 4-1', gender: 'Female' }] });
  for (const attribute of ['data-student-search', 'data-student-section', 'data-student-gender', 'data-select-results', 'data-clear-recipients']) assert.ok(html.includes(attribute));
  assert.match(html, /type="checkbox" name="studentIds" value="1"/);
  assert.doesNotMatch(html, /multiple size|Hold Ctrl/);
});

await test('career names and AI cards stay inside their respective sector sections', async () => {
  const sectorGroups = [
    { name: 'Travel and Tour Operations', tracks: [{ title: 'Reservations Assistant' }], explanations: [{ title: 'Reservations Assistant', alignment: 90, reason: 'Booking evidence.', nextStep: 'Study itineraries.' }] },
    { name: 'Events and MICE', tracks: [{ title: 'Events Coordination Assistant' }], explanations: [{ title: 'Events Coordination Assistant', alignment: 80, reason: 'Events evidence.', nextStep: 'Study conferences.' }] }
  ];
  const context = { ...data, hasPassedModule: true, showCareerMatches: true, sectorGroups };
  const names = await render('views/student/careers.xian', context);
  const lists = [...names.matchAll(/data-career-sector>([\s\S]*?)<\/section>/g)].map(match => match[1]);
  assert.equal(lists.length, 2);
  assert.match(lists[0], /Travel and Tour Operations[\s\S]*Reservations Assistant/);
  assert.doesNotMatch(lists[0], /Events Coordination Assistant/);
  assert.match(lists[1], /Events and MICE[\s\S]*Events Coordination Assistant/);
  assert.doesNotMatch(names, /career-ai-match|evidence alignment|Booking evidence/);
  const explained = await render('views/student/careers.xian', { ...context, ai: { summary: 'Your learning evidence.' } });
  const groups = [...explained.matchAll(/data-career-guidance-sector>([\s\S]*?)<\/section>/g)].map(match => match[1]);
  assert.equal(groups.length, 2);
  assert.match(groups[0], /Travel and Tour Operations[\s\S]*90% evidence alignment[\s\S]*Booking evidence/);
  assert.doesNotMatch(groups[0], /Events evidence/);
  assert.match(groups[1], /Events and MICE[\s\S]*80% evidence alignment[\s\S]*Events evidence/);
});
