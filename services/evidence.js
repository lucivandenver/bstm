import { Op } from 'sequelize';
import { PracticalSubmission } from '../models/portalModels.js';
import { careerMatches } from './learning.js';
export async function buildEvidence(attempts, baseline, interest = '', tracks) {
  const ids = attempts.filter(a => a.status === 'completed').map(a => a.id);
  const practicals = ids.length ? await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: ids }, status: 'graded' }, attributes: ['attemptId','taskId','grade'] }) : [];
  return careerMatches(attempts, baseline, interest, tracks, practicals);
}
export function summarizeLearning(students, attempts, assessments, practicals) {
  const rows = attempts.map(a => a.get ? a.get({ plain: true }) : a);
  const evidence = students.map(student => ({ student, evidence: careerMatches(rows.filter(r => r.userId === student.id), assessments.find(a => a.userId === student.id), '', undefined, practicals) }));
  const names = Object.keys(evidence[0]?.evidence.scores || {});
  const domainSummary = names.map(name => { const values = evidence.map(e => e.evidence.scores[name]).filter(n => n !== null); return { name, assessed: values.length, average: values.length ? Math.round(values.reduce((a,b) => a+b,0) / values.length) : '—', gaps: values.filter(n => n < 75).length }; });
  const sectionSummary = [...new Set(students.map(s => s.section))].map(name => { const ids = students.filter(s => s.section === name).map(s => s.id), scoped = rows.filter(r => ids.includes(r.userId)); return { name: name || 'Unassigned', students: ids.length, attempts: scoped.length, completed: scoped.filter(r => r.status === 'completed').length }; });
  return { domainSummary, sectionSummary };
}
