import { buildEvidence, summarizeLearning } from '../services/evidence.js';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User, Course, CourseAttempt, Assessment, StudentProfile, Notification, sequelize } from '../models/learningModels.js';
import { Section, Announcement, Setting } from '../models/adminModels.js';
import { CourseRevision, CourseAssignment, QuestionBank, SourceDocument, AiJob, PracticalSubmission, FacultyNote, CredentialRequest } from '../models/portalModels.js';
import { text } from '../services/validation.js';
import { audit } from '../services/accounts.js';
import { domains } from '../data/starterCourses.js';
import { blankCourse, courseInput, publishCheck, questionInput, fail } from '../services/courseAuthoring.js';
import { generateCourse, manualSourceDraft, aiConfiguration, sourceSections } from '../services/courseAi.js';
import { generationError, safeGenerationError } from '../services/courseGenerationErrors.js';
import { extractSource } from '../services/sourceExtraction.js';
import { progress, careerMatches, publicQuestions } from '../services/learning.js';
import { finalizeAttempt } from '../services/portalLearning.js';
const plain = r => r?.get({ plain: true });
const date = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
const render = (res, view, data = {}) => res.render(`faculty/${view}`, { facultyNav: view, ...data });
export const assignedSections = req => Section.findAll({ where: { facultyId: req.user.id, active: true } });
export async function assignedStudents(req) { const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), ids = courses.map(c => c.id); const [attempts, assignments] = await Promise.all([CourseAttempt.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['userId'], group: ['userId'] }), CourseAssignment.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['sectionId'] })]); const sections = assignments.length ? await Section.findAll({ where: { id: { [Op.in]: assignments.map(a => a.sectionId) } }, attributes: ['name'] }) : []; const scopes = [{ id: { [Op.in]: attempts.map(a => a.userId) } }]; if (sections.length) scopes.push({ section: { [Op.in]: sections.map(s => s.name) } }); return User.findAll({ where: { role: 'student', [Op.or]: scopes }, attributes: ['id', 'name', 'studentId', 'section', 'email', 'gender'] }); }
async function studentAccess(req) { const students = await assignedStudents(req); const s = students.find(s => s.id === Number(req.params.id)); if (!s) fail('Assigned student not found.', 404); return s; }
async function ownedCourse(req, transaction) { const c = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) }); if (!c) fail('Course not found or not owned by your account.', 404); return c; }
export const dashboard = async (req, res) => {
  const sections = await assignedSections(req), students = await assignedStudents(req), owned = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: owned.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
  const pending = await PracticalSubmission.count({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, status: 'submitted' } });
  const completed = attempts.filter(a => a.status === 'completed').length;
  render(res, 'dashboard', { title: 'Faculty overview', students: students.slice(0, 8).map(plain), sections: sections.map(plain), studentCount: students.length, courseCount: await Course.count({ where: { ownerId: req.user.id } }), publishedCount: await Course.count({ where: { ownerId: req.user.id, published: true } }), pendingCredentials: await CredentialRequest.count({ where: { facultyId: req.user.id, status: 'pending' } }), active: new Set(attempts.filter(a => a.status !== 'completed').map(a => a.userId)).size, pending, completed, completionRate: attempts.length ? Math.round(completed / attempts.length * 100) : 0, support: students.filter(s => attempts.some(a => a.userId === s.id && a.status !== 'completed' && (!a.lastActivityAt || Date.now() - new Date(a.lastActivityAt) > 7 * 86400000))).map(plain) });
};
export const profile = (req, res) => render(res, 'profile', { title: 'My faculty profile', googleConnected: Boolean(req.user.googleId), returned: req.user.approvalStatus === 'returned' });
export const saveProfile = async (req, res) => { const name = text(req.body.name, 100), facultyPosition = text(req.body.facultyPosition, 120), facultyEducation = text(req.body.facultyEducation, 200), facultyQualifications = text(req.body.facultyQualifications, 2000); if (name.length < 2 || !facultyPosition || !facultyEducation || !facultyQualifications) fail('Complete your name, position, education and qualifications.'); const resubmit = req.user.approvalStatus === 'returned'; await req.user.update({ name, facultyPosition, facultyEducation, facultyQualifications, ...(resubmit ? { approvalStatus: 'pending', facultyReviewedBy: null, facultyReviewedAt: null } : {}) }); if (resubmit) { const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] }); await Notification.bulkCreate(admins.map(admin => ({ userId: admin.id, title: 'Faculty registration resubmitted', message: `${name} updated a returned registration for review.`, href: '/admin/faculty?approval=pending' }))); } req.flash('success_msg', resubmit ? 'Profile updated and returned registration resubmitted for Admin review.' : 'Faculty profile saved.'); res.redirect('/faculty/profile'); };
export const credentials = async (req, res) => {
  const courses = await Course.findAll({ where: { ownerId: req.user.id }, order: [['title', 'ASC']] });
  const requests = await CredentialRequest.findAll({ where: { facultyId: req.user.id }, order: [['updatedAt', 'DESC']] });
  const settings = Object.fromEntries((await Setting.findAll({ where: { key: ['institutionName','adminSignature','certificateSignatory'] } })).map(s => [s.key, s.value]));
  render(res, 'credentials', { title: 'Certificates & badges', ...settings, courses: courses.map(c => ({ ...plain(c), request: plain(requests.find(r => r.courseId === c.id)) })) });
};
export const submitCredential = async (req, res) => {
  const course = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!course || !course.published) fail('Publish your course before requesting a certificate and badge approval.');
  const signature = text(req.body.signature, 1200000); if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(signature)) fail('Upload a valid PNG, JPEG or WebP signature image.');
  const label = text(req.body.badgeLabel, 60) || 'Course completion';
  const [request, created] = await CredentialRequest.findOrCreate({ where: { courseId: course.id }, defaults: { facultyId: req.user.id, facultySignature: signature, badge: { enabled: true, label }, status: 'pending' } });
  if (!created) await request.update({ facultyId: req.user.id, facultySignature: signature, badge: { enabled: true, label }, status: 'pending', remarks: null, reviewedBy: null, reviewedAt: null });
  await audit(req.user.id, 'credential.requested', 'course', course.id, { requestId: request.id });
  req.flash('success_msg', 'Credential configuration sent to Admin for review.'); res.redirect('/faculty/credentials');
};
export const courses = async (req, res) => {
  const courses = await Course.findAll({ where: { ownerId: req.user.id }, order: [['updatedAt', 'DESC']] });
  const attempts = await CourseAttempt.findAll({ where: { courseId: { [Op.in]: courses.map(c => c.id) } }, attributes: ['courseId','userId','status'] });
  render(res, 'courses', { title: 'My courses', courses: courses.map(c => { const rows = attempts.filter(a => a.courseId === c.id); return { ...plain(c), moduleCount: c.modules.length, questionCount: c.questions.length, enrolledStudents: new Set(rows.map(a => a.userId)).size, activeLearners: new Set(rows.filter(a => a.status !== 'completed').map(a => a.userId)).size, completedAttempts: rows.filter(a => a.status === 'completed').length }; }) });
};
export const editor = async (req, res) => {
  const course = req.params.id ? plain(await ownedCourse(req)) : blankCourse('');
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
    if (c) { await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'before-edit', snapshot: plain(c) }, { transaction }); await c.update({ ...data, starter: false, awardsApproved: false, version: c.version + 1, published: req.body.action === 'publish' }, { transaction }); await CredentialRequest.update({ status: 'returned', remarks: 'Course content changed. Resubmit the credential configuration for review.' }, { where: { courseId: c.id, status: 'approved' }, transaction }); const attempts = await CourseAttempt.findAll({ where: { courseId: c.id }, transaction }); for (const attempt of attempts) await attempt.update({ snapshot: { ...attempt.snapshot, awardsApproved: false } }, { transaction }); }
    else c = await Course.create({ ...data, ownerId: req.user.id, slug: `faculty-${randomUUID()}`, published: req.body.action === 'publish' }, { transaction });
    id = c.id;
    if (c.published && !wasPublished) {
      const learners = await User.findAll({ where: { role: 'student', active: true }, attributes: ['id'], transaction });
      await Notification.bulkCreate(learners.map(user => ({ userId: user.id, title: 'New course available', message: `${c.title} is now in the learning catalog.`, href: `/student/courses/${c.id}` })), { transaction });
    }
    await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: c.published ? 'published' : 'draft', snapshot: plain(c) }, { transaction });
    await audit(req.user.id, c.published ? 'course.published' : 'course.draft_saved', 'course', c.id, { version: c.version }, transaction);
  });
  req.flash('success_msg', req.body.action === 'publish' ? 'Course published. Certificates and badges remain locked until an Admin approves your credential configuration.' : 'Draft saved. Publishing requires complete, reviewed assessments.'); res.redirect(`/faculty/courses/${id}/edit`);
};
export const archiveCourse = async (req, res) => { const c = await ownedCourse(req); await c.update({ published: false }); await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'archived', snapshot: plain(c) }); await audit(req.user.id, 'course.archived', 'course', c.id); req.flash('success_msg', 'Course archived. Existing attempts remain accessible.'); res.redirect('/faculty/courses'); };
export const preview = async (req, res) => { const c = await ownedCourse(req); render(res, 'preview', { title: 'Student preview', course: plain(c), questions: publicQuestions(c.questions) }); };
const sourceValues = body => ({ domain: domains.includes(body?.domain) ? body.domain : '', outcomes: text(body?.outcomes, 1500), level: ['Foundation','Intermediate','Advanced'].includes(body?.level) ? body.level : 'Foundation', questionCount: Math.max(3, Math.min(30, Number(body?.questionCount) || 8)), consent: body?.consent === 'yes' });
const sourceView = (res, source, body, error) => render(res, 'source', { title: 'Review source material', source: { ...plain(source), sections: sourceSections(source) }, domains, aiReady: aiConfiguration().ready, values: sourceValues(body), error });
export const uploadPage = async (req, res) => render(res, 'upload', { title: 'Upload & generate', domains, aiReady: aiConfiguration().ready, sources: (await SourceDocument.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']], attributes: ['id', 'filename'], limit: 20 })).map(plain), jobs: (await AiJob.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 20 })).map(j => ({ ...plain(j), date: date(j.createdAt) })) });
export const upload = async (req, res) => {
  let sections;
  try { sections = await extractSource(req.file); } catch (e) { if (e.status) throw e; fail('The document could not be read. Try a text-based PDF, DOCX or PPTX.'); }
  let source;
  try {
    source = await sequelize.transaction(async transaction => {
      const row = await SourceDocument.create({ ownerId: req.user.id, filename: text(req.file.originalname, 200), sections }, { transaction });
      await audit(req.user.id, 'source.uploaded', 'source', row.id, { sections: sections.length }, transaction);
      return row;
    });
  } catch (e) {
    const error = safeGenerationError(e, 'upload-save');
    if (req.get('accept')?.includes('application/json')) return res.status(error.status).json({ ok: false, message: error.message, code: error.code, reference: error.reference });
    req.flash('error_msg', `${error.message} Reference: ${error.reference}`); return res.redirect('/faculty/upload');
  }
  req.flash('success_msg', 'Source text extracted. Review it before creating a draft.'); res.redirect(`/faculty/sources/${source.id}`);
};
export const source = async (req, res) => { const s = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!s) fail('Source not found.', 404); sourceView(res, s); };
export const generate = async (req, res) => {
  const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404);
  try {
    const manual = req.body.mode === 'manual', values = sourceValues(req.body);
    if (!domains.includes(req.body.domain)) throw generationError('COURSE_INPUT', 'Choose the competency area for this course.');
    if (!manual && (req.body.consent !== 'yes' || !values.outcomes)) throw generationError('COURSE_INPUT', 'Enter target outcomes and confirm permission to share this source with Gemini.');
    const { course } = await (manual ? manualSourceDraft : generateCourse)(req.user.id, source, { ...req.body, outcomes: values.outcomes });
    req.flash('success_msg', manual ? 'Source imported into an unpublished draft. Add assessments and review all content before publishing.' : 'AI draft created. Check lesson accuracy and every source reference, then mark each question reviewed before publishing.');
    const redirect = `/faculty/courses/${course.id}/edit`;
    if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, redirect });
    res.redirect(redirect);
  } catch (e) {
    const error = e.reference ? e : safeGenerationError(e, 'generate-form');
    if (req.get('accept')?.includes('application/json')) return res.status(error.status).json({ ok: false, message: error.message, code: error.code, reference: error.reference });
    res.status(error.status); sourceView(res, source, req.body, { message: error.message, code: error.code, reference: error.reference });
  }
};
export const bank = async (req, res) => render(res, 'bank', { title: 'Question bank', domains, questions: (await QuestionBank.findAll({ where: { ownerId: req.user.id }, order: [['updatedAt', 'DESC']], limit: 300 })).map(plain) });
export const saveQuestion = async (req, res) => {
  let options; try { options = JSON.parse(req.body.options); } catch { fail('Enter answer choices using the form.'); }
  const data = questionInput({ ...req.body, options, reviewed: req.body.reviewed === 'true' }, req.body.domain); if (!domains.includes(data.domain)) fail('Select a competency area.'); delete data.id; delete data.moduleId;
  if (req.params.id) { const q = await QuestionBank.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!q) fail('Question not found.', 404); await q.update({ ...data, active: req.body.active !== 'false' }); } else await QuestionBank.create({ ...data, ownerId: req.user.id });
  req.flash('success_msg', 'Question saved to your bank.'); res.redirect('/faculty/questions');
};
export const students = async (req, res) => {
  const students = await assignedStudents(req), query = text(req.query.q, 100).toLowerCase(), gender = ['Male','Female'].includes(req.query.gender) ? req.query.gender : '', status = ['not-started','ongoing','completed'].includes(req.query.status) ? req.query.status : '';
  const ownedCourses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id','title'] }), assignments = await CourseAssignment.findAll({ where: { courseId: { [Op.in]: ownedCourses.map(c => c.id) } } }), sections = await Section.findAll({ where: { id: { [Op.in]: assignments.map(a => a.sectionId) } }, attributes: ['id','name'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: ownedCourses.map(c => c.id) } }, order: [['updatedAt','DESC']] });
  const rows = students.filter(s => `${s.name} ${s.studentId} ${s.section}`.toLowerCase().includes(query) && (!gender || s.gender === gender)).map(s => {
    const mine = attempts.filter(a => a.userId === s.id), courseIds = new Set(mine.map(a => a.courseId));
    for (const assigned of assignments) if (sections.find(section => section.id === assigned.sectionId)?.name === s.section) courseIds.add(assigned.courseId);
    const progressRows = [...courseIds].map(courseId => { const attempt = mine.find(a => a.courseId === courseId); const course = ownedCourses.find(c => c.id === courseId); const p = attempt ? progress(attempt) : { done: 0, total: 0, percent: 0 }; return { title: attempt?.snapshot.title || course?.title, ...p, status: attempt?.status || 'not started', score: attempt?.finalScore ?? '—', inactive: Boolean(attempt && attempt.status !== 'completed' && Date.now() - new Date(attempt.lastActivityAt || attempt.createdAt) > 7 * 86400000) }; });
    const done = progressRows.reduce((n,a) => n + a.done, 0), state = !done ? 'not-started' : progressRows.every(a => a.status === 'completed') ? 'completed' : 'ongoing';
    return { ...plain(s), learningStatus: state, progressRows };
  }).filter(s => !status || s.learningStatus === status);
  render(res, 'students', { title: 'Student progress', q: req.query.q, gender, status, students: rows });
};
export const student = async (req, res) => {
  const student = await studentAccess(req), owned = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), attempts = await CourseAttempt.findAll({ where: { userId: student.id, courseId: { [Op.in]: owned.map(c => c.id) } }, order: [['createdAt', 'DESC']] }), assessments = await Assessment.findAll({ where: { userId: student.id }, order: [['createdAt', 'DESC']] });
  const evidence = await buildEvidence(attempts.map(plain), plain(assessments[0]));
  render(res, 'student', { title: student.name, student: plain(student), profile: plain(await StudentProfile.findOne({ where: { userId: student.id } })), attempts: attempts.map(a => ({ ...plain(a), title: a.snapshot.title, ...progress(a), date: date(a.createdAt), lastActivity: date(a.lastActivityAt), minutes: Math.floor(a.activeSeconds / 60), elapsedDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000) })), domains: domains.map(name => ({ name, score: evidence.scores[name] ?? 'Not assessed' })), assessments: assessments.map(a => ({ ...plain(a), date: date(a.createdAt) })), notes: (await FacultyNote.findAll({ where: { studentId: student.id, facultyId: req.user.id }, order: [['createdAt', 'DESC']] })).map(n => ({ ...plain(n), date: date(n.createdAt) })) });
};
export const note = async (req, res) => { const student = await studentAccess(req); const feedback = text(req.body.feedback, 3000), remediation = text(req.body.remediation, 1500); if (!feedback) fail('Enter feedback.'); await FacultyNote.create({ studentId: student.id, facultyId: req.user.id, feedback, remediation, visibility: req.body.visibility === 'student' ? 'student' : 'internal' }); if (req.body.visibility === 'student') await Notification.create({ userId: student.id, title: 'Faculty feedback', message: 'Your faculty added learning feedback and recommended next steps.', href: '/student/results' }); await audit(req.user.id, 'faculty.feedback_added', 'user', student.id); res.redirect(`/faculty/students/${student.id}`); };
export const monitoring = async (req, res) => {
  const students = await assignedStudents(req), names = new Map(students.map(s => [s.id, s]));
  const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const rows = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: courses.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
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
  const students = await assignedStudents(req), courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: courses.map(c => c.id) } } });
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
