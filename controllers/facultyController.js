import { buildEvidence, summarizeLearning } from '../services/evidence.js';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User, Course, CourseAttempt, Assessment, StudentProfile, Notification, sequelize } from '../models/learningModels.js';
import { Section, Announcement } from '../models/adminModels.js';
import { CourseRevision, CourseAssignment, QuestionBank, SourceDocument, AiJob, PracticalSubmission, FacultyNote } from '../models/portalModels.js';
import { text } from '../services/validation.js';
import { audit } from '../services/accounts.js';
import { domains } from '../data/starterCourses.js';
import { blankCourse, courseInput, publishCheck, questionInput, fail } from '../services/courseAuthoring.js';
import { generateCourse } from '../services/courseAi.js';
import { extractSource } from '../services/sourceExtraction.js';
import { progress, careerMatches, publicQuestions } from '../services/learning.js';
import { finalizeAttempt } from '../services/portalLearning.js';
const plain = r => r?.get({ plain: true });
const date = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
const render = (res, view, data = {}) => res.render(`faculty/${view}`, { facultyNav: view, ...data });
export const assignedSections = req => Section.findAll({ where: { facultyId: req.user.id, active: true } });
export async function assignedStudents(req) { const sections = await assignedSections(req); return User.findAll({ where: { role: 'student', section: { [Op.in]: sections.map(s => s.name) } }, attributes: ['id', 'name', 'studentId', 'section', 'email'] }); }
async function studentAccess(req) { const students = await assignedStudents(req); const s = students.find(s => s.id === Number(req.params.id)); if (!s) fail('Assigned student not found.', 404); return s; }
async function ownedCourse(req, transaction) { const c = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) }); if (!c) fail('Course not found or not owned by your account.', 404); return c; }
export const dashboard = async (req, res) => {
  const sections = await assignedSections(req), students = await assignedStudents(req);
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) } }, order: [['createdAt', 'DESC']] });
  const pending = await PracticalSubmission.count({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, status: 'submitted' } });
  const completed = attempts.filter(a => a.status === 'completed').length;
  render(res, 'dashboard', { title: 'Faculty overview', students: students.slice(0, 8).map(plain), sections: sections.map(plain), studentCount: students.length, courseCount: await Course.count({ where: { ownerId: req.user.id } }), active: new Set(attempts.filter(a => a.status !== 'completed').map(a => a.userId)).size, pending, completed, completionRate: attempts.length ? Math.round(completed / attempts.length * 100) : 0, support: students.filter(s => attempts.some(a => a.userId === s.id && a.status !== 'completed' && (!a.lastActivityAt || Date.now() - new Date(a.lastActivityAt) > 7 * 86400000))).map(plain) });
};
export const profile = (req, res) => render(res, 'profile', { title: 'My faculty profile', googleConnected: Boolean(req.user.googleId) });
export const saveProfile = async (req, res) => { const name = text(req.body.name, 100); if (name.length < 2) fail('Enter your full name.'); await req.user.update({ name }); req.flash('success_msg', 'Profile saved. Contact Admin for Faculty ID corrections.'); res.redirect('/faculty/profile'); };
export const courses = async (req, res) => {
  const courses = await Course.findAll({ where: { ownerId: req.user.id }, order: [['updatedAt', 'DESC']] });
  const attempts = await CourseAttempt.findAll({ where: { courseId: { [Op.in]: courses.map(c => c.id) } }, attributes: ['courseId','userId','status'] });
  render(res, 'courses', { title: 'My courses', courses: courses.map(c => { const rows = attempts.filter(a => a.courseId === c.id); return { ...plain(c), moduleCount: c.modules.length, questionCount: c.questions.length, enrolledStudents: new Set(rows.map(a => a.userId)).size, activeLearners: new Set(rows.filter(a => a.status !== 'completed').map(a => a.userId)).size, completedAttempts: rows.filter(a => a.status === 'completed').length }; }) });
};
export const editor = async (req, res) => {
  const course = req.params.id ? plain(await ownedCourse(req)) : blankCourse(domains[0]);
  const [bank, otherCourses, revisions] = await Promise.all([QuestionBank.findAll({ where: { ownerId: req.user.id, active: true, reviewed: true }, limit: 200 }), Course.findAll({ where: { published: true }, attributes: ['id', 'title'] }), course.id ? CourseRevision.findAll({ where: { courseId: course.id }, order: [['createdAt', 'DESC']], limit: 20 }) : []]);
  render(res, 'editor', { title: course.id ? 'Edit course' : 'Create a course', course, domains, bank: bank.map(plain), otherCourses: otherCourses.map(plain), revisions: revisions.map(r => ({ ...plain(r), date: date(r.createdAt) })) });
};
export const saveCourse = async (req, res) => {
  let input; try { input = JSON.parse(req.body.courseData); } catch { fail('Invalid course form. Reload and try again.'); }
  const data = courseInput(input, { draft: req.body.action !== 'publish' }); let id;
  await sequelize.transaction(async transaction => {
    let c = req.params.id ? await ownedCourse(req, transaction) : null;
    const wasPublished = Boolean(c?.published);
    if (c && data.prerequisites.includes(c.id)) fail('A course cannot require itself.');
    // Every prerequisite must exist and cannot create an indirect cycle.
    for (const prerequisite of data.prerequisites) {
      const seen = new Set(); const visit = async cid => { if (c && cid === c.id) fail('Prerequisites would form a cycle.'); if (seen.has(cid)) return; seen.add(cid); const dependency = await Course.findByPk(cid, { transaction }); if (!dependency) fail('Prerequisite course does not exist.'); for (const next of dependency.prerequisites) await visit(Number(next)); }; await visit(prerequisite);
    }
    if (req.body.action === 'publish') publishCheck(data);
    if (c) { await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'before-edit', snapshot: plain(c) }, { transaction }); await c.update({ ...data, starter: false, version: c.version + 1, published: req.body.action === 'publish' }, { transaction }); }
    else c = await Course.create({ ...data, ownerId: req.user.id, slug: `faculty-${randomUUID()}`, published: req.body.action === 'publish' }, { transaction });
    id = c.id;
    if (c.published && !wasPublished) {
      const learners = await User.findAll({ where: { role: 'student', active: true }, attributes: ['id'], transaction });
      await Notification.bulkCreate(learners.map(user => ({ userId: user.id, title: 'New course available', message: `${c.title} is now in the learning catalog.`, href: `/student/courses/${c.id}` })), { transaction });
    }
    await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: c.published ? 'published' : 'draft', snapshot: plain(c) }, { transaction });
    await audit(req.user.id, c.published ? 'course.published' : 'course.draft_saved', 'course', c.id, { version: c.version }, transaction);
  });
  req.flash('success_msg', req.body.action === 'publish' ? 'Course published. Students can now enroll.' : 'Draft saved. Publishing requires complete, reviewed assessments.'); res.redirect(`/faculty/courses/${id}/edit`);
};
export const archiveCourse = async (req, res) => { const c = await ownedCourse(req); await c.update({ published: false }); await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'archived', snapshot: plain(c) }); await audit(req.user.id, 'course.archived', 'course', c.id); req.flash('success_msg', 'Course archived. Existing attempts remain accessible.'); res.redirect('/faculty/courses'); };
export const preview = async (req, res) => { const c = await ownedCourse(req); render(res, 'preview', { title: 'Student preview', course: plain(c), questions: publicQuestions(c.questions) }); };
export const uploadPage = async (req, res) => render(res, 'upload', { title: 'Upload & generate', domains, aiReady: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL), sources: (await SourceDocument.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']], attributes: ['id', 'filename'], limit: 20 })).map(plain), jobs: (await AiJob.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 20 })).map(j => ({ ...plain(j), date: date(j.createdAt) })) });
export const upload = async (req, res) => {
  let sections; try { sections = await extractSource(req.file); } catch (e) { if (e.status) throw e; fail('The document could not be read. Try a text-based PDF, DOCX or PPTX.'); }
  const source = await SourceDocument.create({ ownerId: req.user.id, filename: text(req.file.originalname, 200), sections });
  await audit(req.user.id, 'source.uploaded', 'source', source.id, { sections: sections.length }); req.flash('success_msg', 'Source text extracted. Review it before requesting an AI draft.'); res.redirect(`/faculty/sources/${source.id}`);
};
export const source = async (req, res) => { const s = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!s) fail('Source not found.', 404); render(res, 'source', { title: 'Review source material', source: plain(s), domains }); };
export const generate = async (req, res) => {
  const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404);
  if (req.body.consent !== 'yes' || !domains.includes(req.body.domain) || !text(req.body.outcomes, 1500)) fail('Confirm source sharing, select a domain and enter target learning outcomes.');
  const { draft, job } = await generateCourse(req.user.id, source, { ...req.body, outcomes: text(req.body.outcomes, 1500) });
  const c = await Course.create({ ...draft, ownerId: req.user.id, slug: `ai-${randomUUID()}`, published: false }); await job.update({ courseId: c.id });
  await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: 1, action: 'ai-draft', snapshot: plain(c) });
  req.flash('success_msg', 'AI draft created. Check lesson accuracy and every source reference, then mark each question reviewed before publishing.'); res.redirect(`/faculty/courses/${c.id}/edit`);
};
export const bank = async (req, res) => render(res, 'bank', { title: 'Question bank', domains, questions: (await QuestionBank.findAll({ where: { ownerId: req.user.id }, order: [['updatedAt', 'DESC']], limit: 300 })).map(plain) });
export const saveQuestion = async (req, res) => {
  let options; try { options = JSON.parse(req.body.options); } catch { fail('Enter answer choices using the form.'); }
  const data = questionInput({ ...req.body, options, reviewed: req.body.reviewed === 'true' }, req.body.domain); if (!domains.includes(data.domain)) fail('Select a competency area.'); delete data.id; delete data.moduleId;
  if (req.params.id) { const q = await QuestionBank.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!q) fail('Question not found.', 404); await q.update({ ...data, active: req.body.active !== 'false' }); } else await QuestionBank.create({ ...data, ownerId: req.user.id });
  req.flash('success_msg', 'Question saved to your bank.'); res.redirect('/faculty/questions');
};
export const students = async (req, res) => {
  const students = await assignedStudents(req), sections = await assignedSections(req), query = text(req.query.q, 100).toLowerCase();
  render(res, 'students', { title: 'Students & sections', sections: sections.map(plain), q: req.query.q, students: students.filter(s => `${s.name} ${s.studentId} ${s.section}`.toLowerCase().includes(query)).map(plain) });
};
export const student = async (req, res) => {
  const student = await studentAccess(req), attempts = await CourseAttempt.findAll({ where: { userId: student.id }, order: [['createdAt', 'DESC']] }), assessments = await Assessment.findAll({ where: { userId: student.id }, order: [['createdAt', 'DESC']] });
  const evidence = await buildEvidence(attempts.map(plain), plain(assessments[0]));
  render(res, 'student', { title: student.name, student: plain(student), profile: plain(await StudentProfile.findOne({ where: { userId: student.id } })), attempts: attempts.map(a => ({ ...plain(a), title: a.snapshot.title, ...progress(a), date: date(a.createdAt), lastActivity: date(a.lastActivityAt), minutes: Math.floor(a.activeSeconds / 60), elapsedDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000) })), domains: domains.map(name => ({ name, score: evidence.scores[name] ?? 'Not assessed' })), assessments: assessments.map(a => ({ ...plain(a), date: date(a.createdAt) })), notes: (await FacultyNote.findAll({ where: { studentId: student.id, facultyId: req.user.id }, order: [['createdAt', 'DESC']] })).map(n => ({ ...plain(n), date: date(n.createdAt) })) });
};
export const note = async (req, res) => { const student = await studentAccess(req); const feedback = text(req.body.feedback, 3000), remediation = text(req.body.remediation, 1500); if (!feedback) fail('Enter feedback.'); await FacultyNote.create({ studentId: student.id, facultyId: req.user.id, feedback, remediation, visibility: req.body.visibility === 'student' ? 'student' : 'internal' }); if (req.body.visibility === 'student') await Notification.create({ userId: student.id, title: 'Faculty feedback', message: 'Your faculty added learning feedback and recommended next steps.', href: '/student/results' }); await audit(req.user.id, 'faculty.feedback_added', 'user', student.id); res.redirect(`/faculty/students/${student.id}`); };
export const monitoring = async (req, res) => {
  const students = await assignedStudents(req), names = new Map(students.map(s => [s.id, s]));
  const rows = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) } }, order: [['createdAt', 'DESC']] });
  const tasks = await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: rows.map(a => a.id) }, status: 'submitted' } });
  const attempts = rows.map(a => ({ ...plain(a), student: plain(names.get(a.userId)), title: a.snapshot.title, ...progress(a), awaiting: tasks.some(t => t.attemptId === a.id), inactive: a.status !== 'completed' && Date.now() - new Date(a.lastActivityAt || a.createdAt) > 7 * 86400000, retaking: a.attemptNumber > 1, minutes: Math.floor(a.activeSeconds / 60), elapsedDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000), lastActivity: date(a.lastActivityAt) }));
  if (req.query.export === 'csv') { const cell = v => '"' + (/^[\s]*[=+@-]/.test(String(v ?? '')) ? "'" : '') + String(v ?? '').replaceAll('"', '""') + '"'; res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="assigned-student-progress.csv"' }); return res.send('\uFEFF' + [['Student','Section','Course','Attempt','Status','Final knowledge score','Active minutes','Elapsed days','Last activity'], ...attempts.map(a => [a.student.name,a.student.section,a.title,a.attemptNumber,a.status,a.finalScore,a.minutes,a.elapsedDays,a.lastActivity])].map(r => r.map(cell).join(',')).join('\r\n')); }
  const assessments = await Assessment.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) } }, order: [['createdAt','DESC']] });
  const practicals = await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: rows.filter(r => r.status === 'completed').map(r => r.id) }, status: 'graded' } });
  const { domainSummary, sectionSummary } = summarizeLearning(students, rows, assessments, practicals);
  render(res, req.path === '/reports' ? 'reports' : 'monitoring', { title: req.path === '/reports' ? 'Faculty reports' : 'Progress monitoring', attempts: attempts.map(a => ({ ...a, assessmentMinutes: Math.round(a.quizAttempts.reduce((sum,q) => sum + (q.seconds || 0),0) / 60), statusLabel: a.status === 'completed' ? 'Completed / passed' : a.awaiting ? 'Awaiting faculty grading' : a.done === 0 ? 'Enrolled · not started' : a.finalScore !== null && a.finalScore < a.snapshot.passingScore ? 'Final not passed · review & retry' : 'Ongoing' })), domainSummary, sectionSummary });
};
export const assignments = async (req, res) => { const sections = await assignedSections(req), courses = await Course.findAll({ where: { ownerId: req.user.id, published: true } }), assignments = await CourseAssignment.findAll({ where: { sectionId: { [Op.in]: sections.map(s => s.id) } } }); render(res, 'assignments', { title: 'Required learning', sections: sections.map(plain), courses: courses.map(plain), assignments: assignments.map(a => ({ ...plain(a), sectionName: sections.find(s => s.id === a.sectionId)?.name, courseTitle: courses.find(c => c.id === a.courseId)?.title || 'Course managed by another faculty', date: date(a.dueAt) })) }); };
export const assign = async (req, res) => {
  const section = (await assignedSections(req)).find(s => s.id === Number(req.body.sectionId)); const course = await Course.findOne({ where: { id: req.body.courseId, ownerId: req.user.id, published: true } }); if (!section || !course) fail('Select an assigned section and your published course.');
  const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null; if (dueAt && !Number.isFinite(dueAt.getTime())) fail('Invalid due date.');
  const [row] = await CourseAssignment.findOrCreate({ where: { sectionId: section.id, courseId: course.id }, defaults: { facultyId: req.user.id } }); await row.update({ facultyId: req.user.id, dueAt, required: req.body.required === 'true' });
  const students = (await assignedStudents(req)).filter(s => s.section === section.name);
  await Notification.bulkCreate(students.map(s => ({ userId: s.id, title: 'Learning assignment updated', message: `${course.title}${dueAt ? ' · Due ' + date(dueAt) : ''}`, href: `/student/courses/${course.id}` })));
  await audit(req.user.id, 'course.assigned', 'course', course.id, { sectionId: section.id }); req.flash('success_msg', 'Learning assignment saved. Students were notified.'); res.redirect('/faculty/assignments');
};
export const evaluations = async (req, res) => {
  const students = await assignedStudents(req), attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) } } });
  const rows = await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) } }, order: [['updatedAt', 'DESC']] });
  render(res, 'evaluations', { title: 'Practical evaluations', submissions: rows.map(s => { const a = attempts.find(a => a.id === s.attemptId), task = a.snapshot.tasks?.find(t => t.id === s.taskId); return { ...plain(s), name: students.find(u => u.id === s.userId)?.name, studentId: s.userId, courseTitle: a.snapshot.title, task, date: date(s.updatedAt), criteria: task?.rubric.map(r => ({ ...r, score: s.scores[r.id] ?? '' })), graded: s.status === 'graded' }; }) });
};
export const gradeTask = async (req, res) => {
  const students = await assignedStudents(req); let userId;
  await sequelize.transaction(async transaction => {
    const submission = await PracticalSubmission.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!submission || !students.some(s => s.id === submission.userId)) fail('Submission not found.', 404);
    const attempt = await CourseAttempt.findByPk(submission.attemptId, { transaction, lock: transaction.LOCK.UPDATE }); if (attempt.status === 'completed') fail('Completed attempts are immutable. Contact Admin about a credential review.');
    const task = attempt.snapshot.tasks?.find(t => t.id === submission.taskId); if (!task) fail('Task not found.'); const scores = {};
    for (const r of task.rubric) { const n = Number(req.body.scores?.[r.id]); if (req.body.scores?.[r.id] === '' || !Number.isFinite(n) || n < 0 || n > r.max) fail(`Enter a score from 0 to ${r.max} for ${r.label}.`); scores[r.id] = n; }
    const feedback = text(req.body.feedback, 3000); if (!feedback) fail('Provide feedback with the grade.'); const grade = Math.round(Object.values(scores).reduce((a,b) => a+b, 0) / task.rubric.reduce((a,r) => a+r.max,0) * 100);
    await submission.update({ scores, grade, feedback, status: 'graded', gradedBy: req.user.id, gradedAt: new Date() }, { transaction });
    await attempt.update({ quizScores: { ...attempt.quizScores, [`task:${task.id}`]: grade } }, { transaction });
    const user = students.find(s => s.id === submission.userId); userId = user.id; await finalizeAttempt(attempt, user, transaction);
    await Notification.create({ userId, title: 'Practical task graded', message: `${task.title}: ${grade}%. Review your rubric feedback.`, href: `/student/learn/${attempt.id}/activities` }, { transaction });
    await audit(req.user.id, 'practical.graded', 'attempt', attempt.id, { taskId: task.id, grade }, transaction);
  }); req.flash('success_msg', 'Rubric grade and feedback saved. Completion eligibility was recalculated.'); res.redirect('/faculty/evaluations');
};
export const announcements = async (req, res) => render(res, 'announcements', { title: 'Faculty announcements', announcements: (await Announcement.findAll({ where: { authorId: req.user.id }, order: [['createdAt', 'DESC']] })).map(plain) });
export const announce = async (req, res) => {
  const title = text(req.body.title, 160), body = text(req.body.body, 3000); if (!title || !body) fail('Enter announcement title and message.');
  // Faculty messages go only to currently assigned students, never the whole system.
  const students = await assignedStudents(req); if (!students.length) fail('No active assigned sections. Ask Admin to assign a section.');
  await Announcement.create({ title, body, authorId: req.user.id, audience: 'student', published: false });
  await Notification.bulkCreate(students.map(s => ({ userId: s.id, title, message: body, href: '/student/notifications' })));
  await audit(req.user.id, 'faculty.announcement_sent', 'faculty', req.user.id, { recipients: students.length }); req.flash('success_msg', 'Announcement sent to your assigned students.'); res.redirect('/faculty/announcements');
};
