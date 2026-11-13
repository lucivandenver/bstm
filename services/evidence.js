import { Op } from 'sequelize';
import { PracticalSubmission } from '../models/portalModels.js';
import { careerMatches } from './learning.js';
export async function buildEvidence(attempts, baseline, interest = '', tracks) {
  const ids = attempts.filter(a => a.status === 'completed').map(a => a.id);
  const practicals = ids.length ? await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: ids }, status: 'graded' }, attributes: ['attemptId','taskId','grade'] }) : [];
  return careerMatches(attempts, baseline, interest, tracks, practicals);
}
export function moduleResults(attempt) {
  return (attempt.snapshot.modules || []).map(module => {
    const saved = attempt.quizScores?.[module.id];
    const latest = attempt.quizAttempts?.findLast(quiz => quiz.scope === module.id && !quiz.expired);
    const score = saved >= attempt.snapshot.passingScore ? saved : latest?.score ?? saved;
    return { title: module.title, score, assessed: Number.isFinite(score),
      passed: Number.isFinite(score) && score >= attempt.snapshot.passingScore };
  });
}

export function completionTotals(attempts) {
  const modules = attempts.flatMap(moduleResults);
  return { modulesPassed: modules.filter(module => module.passed).length, modulesTotal: modules.length,
    coursesCompleted: attempts.filter(attempt => attempt.status === 'completed').length };
}

export function summarizeLearning(students, attempts, assessments, practicals) {
  const rows = attempts.map(a => a.get ? a.get({ plain: true }) : a);
  const evidence = students.map(student => ({ student, evidence: careerMatches(rows.filter(r => r.userId === student.id), assessments.find(a => a.userId === student.id), '', undefined, practicals) }));
  const names = Object.keys(evidence[0]?.evidence.scores || {});
  const domainSummary = names.map(name => { const values = evidence.map(e => e.evidence.scores[name]).filter(n => n !== null); return { name, assessed: values.length, average: values.length ? Math.round(values.reduce((a,b) => a+b,0) / values.length) : '—', gaps: values.filter(n => n < 75).length }; });
  const sectionSummary = [...new Set(students.map(s => s.section))].map(name => { const ids = students.filter(s => s.section === name).map(s => s.id), scoped = rows.filter(r => ids.includes(r.userId)); return { name: name || 'Unassigned', students: ids.length, attempts: scoped.length, ...completionTotals(scoped) }; });
  return { domainSummary, sectionSummary };
}
