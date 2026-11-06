import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '../config/env.js';
import { domains } from '../data/starterCourses.js';
export const lessonList = course => course.modules.flatMap(m => m.lessons.map(l => ({ ...l, moduleId: m.id })));
export function progress(attempt) {
  const course = attempt.snapshot;
  const lessons = lessonList(course).length;
  const quizzes = course.modules.length;
  const tasks = (course.tasks || []).filter(t => t.required !== false);
  const extras = (course.policy?.pretest ? 1 : 0) + (course.policy?.feedbackRequired ? 1 : 0) + tasks.length;
  const done = attempt.completedLessons.length + course.modules.filter(m => attempt.quizScores[m.id] >= course.passingScore).length + (attempt.finalScore !== null && attempt.finalScore >= course.passingScore ? 1 : attempt.status === 'completed' ? 1 : 0) + tasks.filter(t => attempt.quizScores[`task:${t.id}`] >= course.passingScore).length + (course.policy?.pretest && attempt.quizAttempts.some(q => q.scope === 'pretest') ? 1 : 0) + (course.policy?.feedbackRequired && attempt.quizScores.feedback === 100 ? 1 : 0);
  return { done, total: lessons + quizzes + 1 + extras, percent: Math.round(done / (lessons + quizzes + 1 + extras) * 100) };
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
export function careerMatches(attempts, baseline, interest = '', tracks = defaultCareerTracks, practicals = []) {
  const latest = new Map();
  for (const attempt of [...attempts].sort((a, b) => new Date(a.completedAt || a.createdAt || 0) - new Date(b.completedAt || b.createdAt || 0))) {
    if (attempt.status === 'completed') latest.set(attempt.courseId, attempt);
  }
  const evidence = Object.fromEntries(domains.map(domain => [domain, []]));
  for (const attempt of latest.values()) {
    const areas = Array.isArray(attempt.snapshot.competencyAreas) && attempt.snapshot.competencyAreas.length
      ? attempt.snapshot.competencyAreas
      : [attempt.snapshot.domain];
    const score = attempt.finalScore === null || attempt.finalScore === undefined ? NaN : Number(attempt.finalScore);
    for (const domain of new Set(areas)) if (evidence[domain] && Number.isFinite(score) && score >= 0 && score <= 100) evidence[domain].push(score);
  }
  const scores = {}, knowledgeScores = {};
  for (const domain of domains) {
    const courseScores = evidence[domain];
    const courseScore = courseScores.length ? courseScores.reduce((a, b) => a + b, 0) / courseScores.length : null;
    const rawDiagnostic = baseline?.scores?.[domain] == null ? NaN : Number(baseline.scores[domain]);
    const diagnosticScore = Number.isFinite(rawDiagnostic) && rawDiagnostic >= 0 && rawDiagnostic <= 100 ? rawDiagnostic : null;
    knowledgeScores[domain] = courseScore !== null && diagnosticScore !== null
      ? Math.round((courseScore + diagnosticScore) / 2)
      : courseScore !== null ? Math.round(courseScore) : diagnosticScore;
    scores[domain] = knowledgeScores[domain];
  }
  const practicalScores = {};
  for (const domain of domains) {
    const values = [];
    for (const attempt of latest.values()) if ((Array.isArray(attempt.snapshot.competencyAreas) && attempt.snapshot.competencyAreas.length ? attempt.snapshot.competencyAreas : [attempt.snapshot.domain]).includes(domain)) {
      const tasks = (attempt.snapshot.tasks || []).filter(t => t.required !== false);
      const valid = tasks.map(t => practicals.find(p => p.attemptId === attempt.id && p.taskId === t.id)).filter(p => p && Number.isFinite(p.grade));
      if (tasks.length && valid.length === tasks.length) values.push(valid.reduce((sum,p) => sum + p.grade,0) / valid.length);
    }
    practicalScores[domain] = values.length ? Math.round(values.reduce((a,b) => a+b,0) / values.length) : null;
    if (scores[domain] !== null && practicalScores[domain] !== null) scores[domain] = Math.round(scores[domain] * 0.7 + practicalScores[domain] * 0.3);
  }
  const interestWords = String(interest || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const stopWords = new Set(['and', 'the', 'for', 'with', 'area', 'career', 'work', 'jobs', 'job']);
  const interestTerms = new Set(interestWords.filter(word => word.length > 2 && !stopWords.has(word)));
  return { scores, knowledgeScores, practicalScores, tracks: tracks.map(track => {
    const required = [...new Set(Array.isArray(track.required) ? track.required.filter(d => domains.includes(d)) : [])];
    const known = required.filter(d => scores[d] !== null);
    const sufficient = required.length > 0 && known.length === required.length;
    const average = known.length ? known.reduce((sum, d) => sum + scores[d], 0) / known.length : 0;
    const gaps = required.filter(d => scores[d] === null || scores[d] < 75);
    const focusTerms = String(track.focus || track.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const preferred = focusTerms.some(word => word.length > 2 && !stopWords.has(word) && interestTerms.has(word));
    const coverage = required.length ? Math.round(known.length / required.length * 100) : 0;
    const rank = (known.length ? Math.round(average * 0.65 + coverage * 0.35) : 0) + (preferred ? 5 : 0);
    const label = !sufficient ? 'More evidence needed' : average >= 85 && !gaps.length ? 'Strong learning alignment' : 'Developing alignment';
    const explanation = !known.length
      ? preferred ? 'This pathway matches your stated career interest. Your diagnostic and completed-course results have not assessed its required areas yet.' : 'Your diagnostic and completed-course results have not assessed this pathway’s required areas yet. Explore the connected courses to build evidence.'
      : !sufficient ? `Your diagnostic and completed-course evidence covers ${known.length} of ${required.length} required areas, averaging ${Math.round(average)}% where assessed. The remaining areas are suggestions for your next learning steps.`
        : `Your latest diagnostic and completed-course evidence averages ${Math.round(average)}% across this pathway’s learning areas. This is an evidence alignment score, not a probability of employment.`;
    return { ...track, required, rank, coverage, assessedAreas: known.length, totalAreas: required.length, label, explanation,
      gaps, strengths: required.filter(d => scores[d] >= 75), preferred };
  }).sort((a, b) => b.rank - a.rank) };
}

export const defaultCareerTracks = [
    { title: 'Travel Consultant / Tour Operations Assistant', focus: 'Travel and tour operations', required: [domains[0], domains[1], domains[3]] },
    { title: 'Guest Services / Front Office Assistant', focus: 'Hospitality and guest services', required: [domains[1], domains[2], domains[3]] },
    { title: 'Events Coordination Assistant', focus: 'Events and MICE', required: [domains[0], domains[1], domains[2]] },
    { title: 'Tourism Information Assistant', focus: 'Destination and visitor services', required: [domains[0], domains[1]] }
  ];
