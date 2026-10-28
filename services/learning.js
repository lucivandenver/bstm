import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '../config/env.js';
import { domains } from '../data/starterCourses.js';
export const lessonList = course => course.modules.flatMap(m => m.lessons.map(l => ({ ...l, moduleId: m.id })));
export function progress(attempt) {
  const course = attempt.snapshot;
  const lessons = lessonList(course).length;
  const quizzes = course.modules.length;
  const done = attempt.completedLessons.length + Object.values(attempt.quizScores).filter(s => s >= course.passingScore).length + (attempt.status === 'completed' ? 1 : 0);
  return { done, total: lessons + quizzes + 1, percent: Math.round(done / (lessons + quizzes + 1) * 100) };
}
export function moduleAvailable(attempt, index) {
  return index === 0 || attempt.quizScores[attempt.snapshot.modules[index - 1].id] >= attempt.snapshot.passingScore;
}
export function canTakeQuiz(attempt, moduleId) {
  const index = attempt.snapshot.modules.findIndex(m => m.id === moduleId);
  return index >= 0 && moduleAvailable(attempt, index) && attempt.snapshot.modules[index].lessons.every(l => attempt.completedLessons.includes(l.id));
}
export const canTakeFinal = attempt => attempt.snapshot.modules.every(m => attempt.quizScores[m.id] >= attempt.snapshot.passingScore);
export function grade(questions, input) {
  if (!questions.length) throw new Error('This assessment has no questions.');
  const answers = questions.map(q => {
    const value = input[q.id];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) >= q.options.length) throw Object.assign(new Error('Answer every question before submitting.'), { status: 400 });
    return Number(value);
  });
  const correct = questions.filter((q, i) => q.answer === answers[i]).length;
  const scores = {};
  for (const domain of domains) {
    const relevant = questions.map((q, i) => ({ q, i })).filter(x => x.q.domain === domain);
    if (relevant.length) scores[domain] = Math.round(relevant.filter(x => x.q.answer === answers[x.i]).length / relevant.length * 100);
  }
  return { score: Math.round(correct / questions.length * 100), scores, answers };
}
export const starsFor = score => score >= 95 ? 3 : score >= 85 ? 2 : 1;
export function publicQuestions(questions) {
  return questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options }));
}
// Stateless, signed form challenges survive multiple open tabs; DB transaction prevents duplicate submissions.
export function issueChallenge(userId, scope) {
  const payload = Buffer.from(JSON.stringify({ userId, scope, nonce: randomBytes(16).toString('hex'), exp: Date.now() + 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', sessionSecret).update(payload).digest('hex')}`;
}
export function checkChallenge(token, userId, scope) {
  if (typeof token !== 'string' || token.length > 1000) throw Object.assign(new Error('Assessment expired. Reload and try again.'), { status: 400 });
  const [payload, mac] = token.split('.');
  const expected = createHmac('sha256', sessionSecret).update(payload || '').digest('hex');
  if (!mac || !/^[a-f0-9]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw Object.assign(new Error('Assessment expired.'), { status: 400 });
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.userId !== userId || data.scope !== scope || data.exp < Date.now()) throw Object.assign(new Error('Assessment expired.'), { status: 400 });
  return data.nonce;
}
export function careerMatches(attempts, baseline, interest = '', tracks = defaultCareerTracks) {
  const latest = new Map();
  for (const attempt of [...attempts].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))) {
    if (attempt.status === 'completed') latest.set(attempt.courseId, attempt);
  }
  const evidence = Object.fromEntries(domains.map(domain => [domain, []]));
  for (const attempt of latest.values()) {
    const domain = attempt.snapshot.domain;
    if (evidence[domain]) evidence[domain].push(attempt.finalScore);
  }
  const scores = {};
  for (const domain of domains) {
    const courseScores = evidence[domain];
    scores[domain] = courseScores.length ? Math.round(courseScores.reduce((a, b) => a + b, 0) / courseScores.length) : baseline?.scores?.[domain] ?? null;
  }
  return { scores, tracks: tracks.map(track => {
    const known = track.required.filter(d => scores[d] !== null);
    const sufficient = known.length === track.required.length;
    const average = known.length ? known.reduce((sum, d) => sum + scores[d], 0) / known.length : 0;
    const gaps = track.required.filter(d => scores[d] === null || scores[d] < 75);
    return { ...track, rank: sufficient ? average : -1, label: !sufficient ? 'More evidence needed' : average >= 85 && !gaps.length ? 'Strong learning alignment' : 'Developing alignment',
      explanation: !sufficient ? 'Complete assessments in each required area to develop this recommendation.' : `Your available knowledge evidence averages ${Math.round(average)}% across this pathway’s learning areas. This is not a probability of employment.`,
      gaps, strengths: track.required.filter(d => scores[d] >= 75), preferred: interest.toLowerCase().includes(track.focus.split(' ')[0].toLowerCase()) };
  }).sort((a, b) => b.rank - a.rank) };
}

export const defaultCareerTracks = [
    { title: 'Travel Consultant / Tour Operations Assistant', focus: 'Travel and tour operations', required: [domains[0], domains[1], domains[3]] },
    { title: 'Guest Services / Front Office Assistant', focus: 'Hospitality and guest services', required: [domains[1], domains[2], domains[3]] },
    { title: 'Events Coordination Assistant', focus: 'Events and MICE', required: [domains[0], domains[1], domains[2]] },
    { title: 'Tourism Information Assistant', focus: 'Destination and visitor services', required: [domains[0], domains[1]] }
  ];
