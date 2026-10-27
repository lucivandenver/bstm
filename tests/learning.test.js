import test from 'node:test';
import assert from 'node:assert/strict';
import { starterCourses, baselineQuestions, domains } from '../data/starterCourses.js';
import { grade, publicQuestions, progress, moduleAvailable, canTakeFinal, canTakeQuiz, careerMatches, issueChallenge, checkChallenge, starsFor } from '../services/learning.js';
import { registrationInput, profileInput } from '../services/validation.js';
const course = starterCourses[0];
const fresh = () => ({ snapshot: course, completedLessons: [], quizScores: {}, status: 'ongoing' });
test('answer keys stay server-side and grading rejects missing / invalid answers', () => {
  assert.ok(publicQuestions(course.questions).every(q => !('answer' in q) && !('explanation' in q)));
  assert.throws(() => grade(course.questions, {}), /Answer every/);
  assert.throws(() => grade(course.questions, { t1: '-1' }), /Answer every/);
  const result = grade(course.questions, Object.fromEntries(course.questions.map(q => [q.id, String(q.answer)])));
  assert.equal(result.score, 100);
  assert.equal(result.scores[domains[0]], 100);
  const wrong = grade(course.questions, Object.fromEntries(course.questions.map(q => [q.id, String((q.answer + 1) % q.options.length)])));
  assert.equal(wrong.score, 0);
});
test('module prerequisites and completion gates cannot be skipped', () => {
  const a = fresh();
  assert.equal(moduleAvailable(a, 1), false);
  assert.equal(canTakeQuiz(a, 'planning'), false);
  assert.equal(canTakeFinal(a), false);
  a.completedLessons = course.modules[0].lessons.map(l => l.id);
  assert.equal(canTakeQuiz(a, 'planning'), true);
  a.quizScores.planning = 50;
  assert.equal(moduleAvailable(a, 1), false);
  a.quizScores.planning = 100;
  assert.equal(moduleAvailable(a, 1), true);
  assert.equal(canTakeQuiz(a, 'unknown'), false);
  assert.ok(progress(a).percent < 100);
  a.completedLessons = course.modules.flatMap(m => m.lessons.map(l => l.id));
  a.quizScores.responsible = 100;
  assert.equal(canTakeFinal(a), true);
  a.status = 'completed';
  assert.equal(progress(a).percent, 100);
});
test('career evidence excludes ongoing / unlocked courses and uses latest completed retake once', () => {
  const complete = (courseId, score, completedAt) => ({ courseId, status: 'completed', snapshot: course, finalScore: score, completedAt });
  const a = complete(1, 100, '2026-01-01');
  const b = complete(1, 75, '2026-02-01');
  const ongoing = { ...complete(2, 100, '2026-03-01'), status: 'ongoing' };
  const evidence = careerMatches([a, b, ongoing], null);
  assert.equal(evidence.scores[domains[0]], 75);
  assert.equal(evidence.scores[domains[1]], null);
  assert.ok(evidence.tracks.every(t => t.label === 'More evidence needed'));
  const baseline = Object.fromEntries(domains.map(d => [d, 50]));
  assert.equal(careerMatches([a], { scores: baseline }).scores[domains[1]], 50);
  assert.equal(careerMatches([a], { scores: baseline }).scores[domains[0]], 100);
});
test('signed assessment challenge binds user and scope and rejects tampering', () => {
  const token = issueChallenge(1, '5:final');
  assert.equal(typeof checkChallenge(token, 1, '5:final'), 'string');
  assert.throws(() => checkChallenge(token, 2, '5:final'));
  assert.throws(() => checkChallenge(token, 1, '6:final'));
  assert.throws(() => checkChallenge(token + 'a', 1, '5:final'));
  assert.throws(() => checkChallenge('not-a-token', 1, 'baseline'));
});
test('signup validates identity fields, confirmation and bcrypt byte limits', () => {
  const input = { name: 'Student Test', email: ' TEST@EXAMPLE.COM ', student_id: '2026-001', section: '4-1', password: 'longpassword123', confirm_password: 'longpassword123', role: 'admin' };
  assert.equal(registrationInput(input).email, 'test@example.com');
  assert.equal(registrationInput(input).studentId, '2026-001');
  assert.equal(registrationInput(input).role, undefined);
  assert.throws(() => registrationInput({ ...input, confirm_password: 'wrong' }), /match/);
  assert.throws(() => registrationInput({ ...input, password: 'x' }), /password/);
  assert.throws(() => registrationInput({ ...input, password: '🙂'.repeat(30), confirm_password: '🙂'.repeat(30) }), /password/);
});
test('profile validates required academic details and bounded OJT hours', () => {
  const input = { yearLevel: 'Graduating', academicYear: '2026-2027', graduationYear: '2027', ojtStatus: 'Ongoing', ojtHours: '300', careerInterest: 'Events', preferredLocation: 'Philippines' };
  assert.equal(profileInput(input).complete, true);
  assert.equal(profileInput(input).ojtHours, 300);
  assert.throws(() => profileInput({ ...input, ojtHours: '-1' }), /hours/);
  assert.throws(() => profileInput({ ...input, academicYear: '2026' }), /academic year/);
});
test('starter course references, question keys and baseline cover four areas', () => {
  for (const c of starterCourses) {
    const modules = new Set(c.modules.map(m => m.id));
    const lessons = c.modules.flatMap(m => m.lessons.map(l => l.id));
    assert.equal(new Set(lessons).size, lessons.length);
    assert.equal(new Set(c.questions.map(q => q.id)).size, c.questions.length);
    for (const question of c.questions) {
      assert.ok(modules.has(question.moduleId));
      assert.ok(question.answer >= 0 && question.answer < question.options.length);
    }
    assert.ok(c.modules.every(m => c.questions.some(q => q.moduleId === m.id)));
  }
  assert.equal(new Set(baselineQuestions.map(q => q.domain)).size, 4);
  assert.equal(starsFor(75), 1); assert.equal(starsFor(85), 2); assert.equal(starsFor(95), 3);
});
