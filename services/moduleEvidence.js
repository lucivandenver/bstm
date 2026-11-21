import { careerSectors, sectorsForModule, sectorCareerTracks } from './careerSectors.js';
import { domains } from '../data/starterCourses.js';
import { careerMatches, moduleAssessmentResult } from './learning.js';

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
  const completed = modules.filter(module => module.passed).length;
  return completed === modules.length ? 100 : Math.min(99, Math.round(100 * completed / modules.length));
}

export function moduleEvidence(attempts, tracks, { assessedOnly = false, availableCourses } = {}) {
  const modules = new Map();
  const sorted = [...attempts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.attemptNumber - a.attemptNumber);
  for (const attempt of sorted) {
    const { snapshot } = attempt;
    for (const module of snapshot.modules || []) {
      const key = `${attempt.courseId}:${module.id}`;
      const latestResult = moduleAssessmentResult(attempt, module.id);
      const score = latestResult?.score;
      if (assessedOnly && !Number.isFinite(score)) continue;
      const topics = module.lessons || [];
      const lessons = topics.filter(lesson => attempt.completedLessons?.includes(lesson.id)).length;
      const read = Boolean(attempt.quizScores?.[`read:${module.id}`]);
      if (!Number.isFinite(score) && !lessons && !read) continue;
      const passingScore = snapshot.passingScore;
      const submissions = (attempt.quizAttempts || []).filter(result => result.scope === module.id);
      const firstPassIndex = submissions.findIndex(result => !result.expired && Number.isFinite(result.score) && result.score >= passingScore);
      const retakeCount = Math.max(attempt.quizScores?.[`retake:${module.id}`] || 0, submissions.length - 1, 0);
      const retakeHistoryAvailable = submissions.length > 0 || Object.hasOwn(attempt.quizScores || {}, `retake:${module.id}`);
      const retakesBeforePass = retakeHistoryAvailable ? firstPassIndex >= 0 ? firstPassIndex : retakeCount : null;
      const passed = Number.isFinite(score) && score >= passingScore;
      if (modules.has(key) && !passed) continue;
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
      modules.set(key, { courseId: attempt.courseId, moduleId: module.id, attemptId: attempt.id, sectors: sectorsForModule(snapshot, module), finalAssessmentScore: attempt.status === 'completed' && Number.isFinite(attempt.finalScore) && attempt.finalScore >= snapshot.passingScore ? attempt.finalScore : null, title: module.title, courseTitle: snapshot.title, areas, scores,
        retakeHistoryAvailable, retakesBeforePass, retakeCount, score: Number.isFinite(score) ? score : null, assessed: Number.isFinite(score), passed, passingScore, done, total,
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

export function studentCareerEvidence(attempts, tracks, credentials = []) {
  const evidence = moduleEvidence(attempts, tracks, { assessedOnly: true });
  for (const module of evidence.completed) module.certificateEarned = credentials.some(c => !c.revoked && Number(c.attemptId) === Number(module.attemptId) && (!c.moduleId || c.moduleId === module.moduleId));
  const learning = {
    completed: evidence.completed.map(({ title, score, scores, percent, certificateEarned, finalAssessmentScore, sectors, retakesBeforePass, retakeCount, retakeHistoryAvailable }) => ({ title, score, scores, percent, certificateEarned, finalAssessmentScore, sectors, retakesBeforePass, retakeCount, retakeHistoryAvailable })),
    developing: evidence.developing.map(({ title, score, scores, percent, certificateEarned, finalAssessmentScore, sectors, retakesBeforePass, retakeCount, retakeHistoryAvailable }) => ({ title, score, scores, percent, certificateEarned, finalAssessmentScore, sectors, retakesBeforePass, retakeCount, retakeHistoryAvailable }))
  };
  const ranked = sectorCareerTracks(evidence.tracks, evidence.completed);
  for (const track of ranked) {
    track.failedModules = evidence.developing.filter(module => module.assessed && module.sectors.includes(track.sector));
    track.gaps = [...new Set([...track.gaps, ...track.failedModules.flatMap(module => Object.entries(module.scores).filter(([,score]) => score < module.passingScore).map(([area]) => area))])];
  }
  const sectors = careerSectors.map(sector => {
    const matches = ranked.filter(track => track.sector === sector.name);
    const best = matches[0];
    const modules = evidence.completed.filter(module => module.sectors.includes(sector.name));
    return { name: sector.name, percent: best?.rank ?? 0, assessed: Boolean(best), matches: matches.length,
      passedModules: modules.length, certificates: modules.filter(module => module.certificateEarned).length };
  });
  return { ...evidence, tracks: ranked, sectors: sectors.filter(sector => sector.assessed), learning };
}
