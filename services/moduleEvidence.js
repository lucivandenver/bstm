import { domains } from '../data/starterCourses.js';
import { careerMatches } from './learning.js';

function moduleQuestionAreas(course, module) {
  return [...new Set((course.questions || [])
    .filter(question => question.moduleId === module.id)
    .map(question => question.domain)
    .filter(area => domains.includes(area)))];
}

function courseAreas(course) {
  return (course.competencyAreas?.length ? course.competencyAreas : [course.domain])
    .filter(area => domains.includes(area));
}

function moduleCompletionPercent(modules) {
  if (!modules.length) return 0;
  const completed = modules.reduce((sum, module) => sum + (module.passed ? 1 : module.fraction * 0.25), 0);
  return completed === modules.length ? 100 : Math.min(99, Math.round(100 * completed / modules.length));
}

export function moduleEvidence(attempts, tracks, { assessedOnly = false, availableCourses } = {}) {
  const modules = new Map();
  const sorted = [...attempts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.attemptNumber - a.attemptNumber);
  for (const attempt of sorted) {
    const { snapshot } = attempt;
    for (const module of snapshot.modules || []) {
      const key = `${attempt.courseId}:${module.id}`;
      if (modules.has(key)) continue;
      const latestResult = assessedOnly && attempt.quizAttempts?.findLast(quiz =>
        quiz.scope === module.id && !quiz.expired && Number.isFinite(quiz.score));
      const score = latestResult ? latestResult.score : attempt.quizScores?.[module.id];
      if (assessedOnly && !Number.isFinite(score)) continue;
      const topics = module.lessons || [];
      const lessons = topics.filter(lesson => attempt.completedLessons?.includes(lesson.id)).length;
      const read = Boolean(attempt.quizScores?.[`read:${module.id}`]);
      if (!Number.isFinite(score) && !lessons && !read) continue;
      const passingScore = snapshot.passingScore;
      const passed = Number.isFinite(score) && score >= passingScore;
      const questionAreas = moduleQuestionAreas(snapshot, module);
      const areas = questionAreas.length ? questionAreas : courseAreas(snapshot);
      const result = latestResult || attempt.quizAttempts?.findLast(quiz => quiz.scope === module.id && !quiz.expired && quiz.score === score);
      // Older attempts store only the total quiz score. Use it for the module's primary assessed area.
      const primary = assessedOnly
        ? (questionAreas.length === 1 ? questionAreas[0] : undefined)
        : (areas.length === 1 ? areas[0] : areas.find(area => area === snapshot.domain));
      const recordedScores = result?.scores || (primary && Number.isFinite(score) ? { [primary]: score } : {});
      const scores = Object.fromEntries(Object.entries(recordedScores).filter(([area, value]) =>
        domains.includes(area) && Number.isFinite(value) && value >= 0 && value <= 100));
      const total = topics.length + Number(Boolean(module.materials?.length)) + 1;
      const done = lessons + Number(Boolean(module.materials?.length) && read) + Number(Number.isFinite(score));
      modules.set(key, { title: module.title, courseTitle: snapshot.title, areas, scores,
        score: Number.isFinite(score) ? score : null, assessed: Number.isFinite(score), passed, passingScore, done, total,
        percent: passed && !assessedOnly ? 100 : Math.round(100 * done / total) });
    }
  }
  const records = [...modules.values()];
  const completed = records.filter(module => module.passed);
  const developing = records.filter(module => !module.passed);
  const progressModules = availableCourses ? availableCourses.flatMap(course => course.modules.map(module => {
    const questionAreas = moduleQuestionAreas(course, module);
    const record = modules.get(`${course.id}:${module.id}`);
    return {
      areas: questionAreas.length ? questionAreas : courseAreas(course),
      passed: Boolean(record?.passed),
      fraction: record ? record.done / record.total : 0
    };
  })) : records.map(module => ({ ...module, fraction: module.done / module.total }));
  const competencies = domains.map(name => {
    const relevant = progressModules.filter(module => module.areas.includes(name));
    const passed = relevant.filter(module => module.passed).length;
    return { name, percent: moduleCompletionPercent(relevant), passed, total: relevant.length };
  });
  const scores = Object.fromEntries(domains.map(area => {
    const values = completed.map(module => module.scores[area]).filter(Number.isFinite);
    return [area, values.length ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length) : null];
  }));
  const ranked = careerMatches([], { scores }, '', tracks);
  ranked.tracks = ranked.tracks.filter(track => track.assessedAreas).map(track => ({
    ...track,
    explanation: `Passed module assessments cover ${track.assessedAreas} of ${track.totalAreas} required competency areas.`
  }));
  const overall = moduleCompletionPercent(progressModules);
  return { ...ranked, completed, developing, competencies, overall,
    lowScores: developing.filter(module => module.score !== null) };
}

export function studentCareerEvidence(attempts, tracks) {
  const evidence = moduleEvidence(attempts, tracks, { assessedOnly: true });
  const learning = {
    completed: evidence.completed.map(({ title, score, scores, percent }) => ({ title, score, scores, percent })),
    developing: evidence.developing.map(({ title, score, scores, percent }) => ({ title, score, scores, percent }))
  };
  const ranked = evidence.tracks.map(track => ({
    ...track,
    required: track.required.filter(area => Object.hasOwn(evidence.scores, area) && evidence.scores[area] !== null),
    gaps: track.required.filter(area => [...evidence.completed, ...evidence.developing].some(module =>
      Number.isFinite(module.scores[area]) && module.scores[area] < module.passingScore)),
    supportingModules: learning.completed.flatMap(module => {
      const areas = Object.entries(module.scores).filter(([area]) => track.required.includes(area))
        .map(([name, score]) => ({ name, score }));
      return areas.length ? [{ title: module.title, score: module.score, percent: module.percent, areas }] : [];
    }),
    explanation: 'This pathway overlaps with competencies scored in your passed module quizzes.'
  }));
  return { ...evidence, tracks: ranked, learning };
}
