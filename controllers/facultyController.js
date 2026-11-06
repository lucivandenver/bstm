import { createHash } from 'node:crypto';
import { sourceLimits } from '../services/sourceLimits.js';
import { startCourseJob, startBlueprintJob, courseJobStatus } from '../services/courseJobs.js';
import { validatedSignature } from '../services/signatureProcessing.js';
import { buildEvidence, summarizeLearning } from '../services/evidence.js';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User, Course, CourseAttempt, Assessment, StudentProfile, Notification, sequelize } from '../models/learningModels.js';
import { Section, Announcement, Setting } from '../models/adminModels.js';
import { CourseRevision, CourseAssignment, QuestionBank, SourceDocument, AiJob, PracticalSubmission, FacultyNote, CredentialRequest } from '../models/portalModels.js';
import { text } from '../services/validation.js';
import { audit } from '../services/accounts.js';
import { domains } from '../data/starterCourses.js';
import { courseAreas, courseInput, publishCheck, questionInput, fail } from '../services/courseAuthoring.js';
import { generateCourse, aiConfiguration, sourceSections } from '../services/courseAi.js';
import { generationError, safeGenerationError } from '../services/courseGenerationErrors.js';
import { extractSource } from '../services/sourceExtraction.js';
import { progress, careerMatches, publicQuestions } from '../services/learning.js';
import { finalizeAttempt } from '../services/portalLearning.js';
function savedArray(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value : [];
}
const plain = r => r?.get({ plain: true });
const date = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
const render = (res, view, data = {}) => res.render(`faculty/${view}`, { facultyNav: view, ...data });
export const assignedSections = req => Section.findAll({ where: { active: true }, order: [['name','ASC']] });
export async function assignedStudents(req) { const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), ids = courses.map(c => c.id); const [attempts, assignments, legacySections] = await Promise.all([CourseAttempt.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['userId'], group: ['userId'] }), CourseAssignment.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['sectionId'] }), Section.findAll({ where: { facultyId: req.user.id, active: true }, attributes: ['id', 'name'] })]); const sections = [...new Map([...legacySections, ...(assignments.length ? await Section.findAll({ where: { id: { [Op.in]: assignments.map(a => a.sectionId) } }, attributes: ['id', 'name'] }) : [])].map(section => [section.id, section])).values()]; const scopes = [{ id: { [Op.in]: attempts.map(a => a.userId) } }]; if (sections.length) scopes.push({ section: { [Op.in]: sections.map(s => s.name) } }); return User.findAll({ where: { role: 'student', [Op.or]: scopes }, attributes: ['id', 'name', 'studentId', 'section', 'email', 'gender'] }); }
async function studentAccess(req) { const students = await assignedStudents(req); const s = students.find(s => s.id === Number(req.params.id)); if (!s) fail('Assigned student not found.', 404); return s; }
async function ownedCourse(req, transaction) { const c = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) }); if (!c) fail('Course not found or not owned by your account.', 404); return c; }
export const dashboard = async (req, res) => {
  const sections = await assignedSections(req), students = await assignedStudents(req), owned = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: owned.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
  c