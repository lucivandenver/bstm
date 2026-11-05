import { randomUUID } from 'node:crypto';
import { domains } from '../data/starterCourses.js';
import { text } from './validation.js';
export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const array = (value, max, label) => { if (!Array.isArray(value) || value.length > max) fail(`Invalid ${label}.`); return value; };
const id = (value, label) => { if (!/^[a-zA-Z0-9_-]{1,60}$/.test(value)) fail(`Invalid ${label} ID.`); return value; };
export function questionInput(q, domain) {
  const prompt = text(q.prompt, 1500), options = array(q.options, 6, 'answer choices').map(o => text(o, 500));
  if (prompt.length < 8 || options.length < 2 || options.some(o => !o) || new Set(options.map(o => o.toLowerCase())).size !== options.length || !Number.isInteger(Number(q.answer)) || Number(q.answer) < 0 || Number(q.answer) >= options.length) fail('Each question needs a clear prompt, distinct choices and one correct answer.');
  return { id: id(q.id || randomUUID(), 'question'), prompt, options, answer: Number(q.answer), explanation: text(q.explanation, 2000), domain: domains.includes(q.domain) ? q.domain : domain, moduleId: text(q.moduleId, 60), sourceReference: text(q.sourceReference, 200), sourceQuote: text(q.sourceQuote, 1200), reviewed: q.reviewed === true };
}
export function courseAreas(value, primary) {
  const selected = Array.isArray(value) && value.length ? value : [primary];
  if (selected.some(area => !domains.includes(area))) fail('Select valid competency areas.');
  return [...new Set(selected)];
}
export function courseInput(input, { draft = false } = {}) {
  const title = text(input.title, 160), description = text(input.description, 4000), domain = text(input.domain, 60);
  if (title.length < 4 || !description || !domains.includes(domain)) fail('Enter a course title, description and competency area.');
  const passingScore = Number(input.passingScore), minutes = Number(input.minutes);
  if (!Number.isInteger(passingScore) || passingScore < 50 || passingScore > 100 || !Number.isInteger(minutes) || minutes < 5 || minutes > 6000) fail('Use a passing score of 50–100 and a learning time of 5–6000 minutes.');
  const modules = array(input.modules, 20, 'modules').map(m => ({ id: id(m.id, 'module'), title: text(m.title, 160), lessons: array(m.lessons, 30, 'lessons').map(l => ({ id: id(l.id, 'lesson'), title: text(l.title, 160), body: text(l.body, 16000), takeaways: array(l.takeaways || [], 12, 'takeaways').map(t => text(t, 600)) })) }));
  const questions = array(input.questions, 120, 'questions').map(q => draft ? { id: id(q.id, 'question'), prompt: text(q.prompt,1500), options: array(q.options,6,'answer choices').map(o => text(o,500)), answer: Number.isInteger(Number(q.answer)) ? Number(q.answer) : 0, explanation: text(q.explanation,2000), domain: domains.includes(q.domain) ? q.domain : domain, moduleId: text(q.moduleId,60), sourceReference: text(q.sourceReference,200), sourceQuote: text(q.sourceQuote,1200), reviewed: q.reviewed === true } : questionInput(q, domain));
  const tasks = array(input.tasks || [], 10, 'practical tasks').map(t => ({ id: id(t.id, 'task'), title: text(t.title, 160), required: t.required !== false, instructions: text(t.instructions, 3000), rubric: array(t.rubric, 10, 'rubric criteria').map(r => ({ id: id(r.id, 'criterion'), label: text(r.label, 160), max: Number(r.max) })) }));
  const allIds = [...modules.map(m => m.id), ...modules.flatMap(m => m.lessons.map(l => l.id)), ...questions.map(q => q.id), ...tasks.map(t => t.id)];
  if (new Set(allIds).size !== allIds.length) fail('Module, lesson, question and task IDs must be unique.');
  if (questions.some(q => !modules.some(m => m.id === q.moduleId))) fail('Assign every question to an existing module.');
  for (const t of tasks) if (!t.title || !t.instructions || !t.rubric.length || new Set(t.rubric.map(r => r.id)).size !== t.rubric.length || t.rubric.some(r => !r.label || !Number.isInteger(r.max) || r.max < 1 || r.max > 100)) fail('Each practical task needs instructions and distinct rubric criteria (1–100 points).');
  const p = input.policy || {};
  const policy = { quizMinutes: Number(p.quizMinutes || 0), attemptLimit: Number(p.attemptLimit || 0), randomize: p.randomize === true, feedbackRequired: p.feedbackRequired === true, pretest: p.pretest === true, feedbackTiming: p.feedbackTiming === 'after-completion' ? 'after-completion' : 'immediate', quizWeight: Number(p.quizWeight ?? (tasks.length ? 30 : 40)), finalWeight: Number(p.finalWeight ?? (tasks.length ? 40 : 60)), practicalWeight: Number(p.practicalWeight ?? (tasks.length ? 30 : 0)) };
  if (!Number.isInteger(policy.quizMinutes) || policy.quizMinutes < 0 || policy.quizMinutes > 180 || !Number.isInteger(policy.attemptLimit) || policy.attemptLimit < 0 || policy.attemptLimit > 20 || [policy.quizWeight, policy.finalWeight, policy.practicalWeight].some(n => !Number.isInteger(n) || n < 0 || n > 100) || policy.quizWeight + policy.finalWeight + policy.practicalWeight !== 100 || (!tasks.some(t => t.required) && policy.practicalWeight !== 0)) fail('Check quiz limits and grading weights; weights must total 100.');
  const date = value => { if (!value) return null; const d = new Date(value); if (!Number.isFinite(d.getTime())) fail('Invalid enrollment/deadline date.'); return d; };
  const enrollFrom = date(input.enrollFrom), enrollUntil = date(input.enrollUntil), deadline = date(input.deadline);
  if (enrollFrom && enrollUntil && enrollUntil <= enrollFrom) fail('Enrollment closing must be after opening.');
  const prerequisites = array(input.prerequisites || [], 30, 'prerequisites').map(Number); if (prerequisites.some(n => !Number.isInteger(n) || n < 1)) fail('Invalid prerequisite course.');
  return { title, description, domain, competencyAreas: courseAreas(input.competencyAreas, domain), passingScore, minutes, level: ['Foundation', 'Intermediate', 'Advanced'].includes(input.level) ? input.level : 'Foundation', outcomes: array(input.outcomes || [], 20, 'outcomes').map(o => text(o, 500)).filter(Boolean), modules, questions, tasks, policy, prerequisites: [...new Set(prerequisites)], enrollFrom, enrollUntil, deadline, certificateEnabled: input.certificateEnabled !== false };
}
export function publishCheck(c) {
  courseInput(c); // Re-validate drafts before any publication path, including Admin.
  if (!c.outcomes?.length || !c.modules?.length || !c.questions?.length) fail('Add learning outcomes, modules, lessons and questions before publishing.');
  if (c.modules.some(m => !m.title || !m.lessons.length || m.lessons.some(l => !l.title || l.body.length < 30) || !c.questions.some(q => q.moduleId === m.id))) fail('Each module needs a title, a complete lesson and at least one quiz question.');
  if (c.questions.some(q => !q.reviewed || !q.explanation)) fail('Review every question and provide its answer explanation before publishing.');
}
