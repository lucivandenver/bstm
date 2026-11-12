import { sendWorkbook } from '../services/reportWorkbook.js';
import { duplicateModule, duplicateModuleMessage } from '../services/moduleDuplicates.js';
import { facultySignature, preparePublicationCredential } from '../services/publicationCredentials.js';
import { courseAiConfiguration, missingVertexSettings } from '../services/courseAiProvider.js';
import { summarizeLearning } from '../services/evidence.js';
import { PracticalSubmission, CredentialRequest, ProfileCorrection } from '../models/portalModels.js';
import { CourseRevision, CourseAssignment, AiJob } from '../models/portalModels.js';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User, Course, CourseAttempt, StudentProfile, Credential, Assessment, Notification, SavedCourse, SavedModule, sequelize } from '../models/learningModels.js';
import { Section, AuditLog, Setting, Announcement, CareerPath } from '../models/adminModels.js';
import { courseInput, publishCheck } from '../services/courseAuthoring.js';
import { audit, ownerEmail, genders, setting } from '../services/accounts.js';
import { text, email } from '../services/validation.js';
import { domains } from '../data/starterCourses.js';
import { starsFor } from '../services/learning.js';
const plain = row => row?.get({ plain: true });
const publicUser = row => { const { password, googleId, ...user } = plain(row); return { ...user, googleConnected: Boolean(googleId), owner: user.email === ownerEmail() }; };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const platformPages = new Set(['reports', 'maintenance', 'announcements', 'careers', 'competencies', 'ai', 'academic']);
const render = (res, view, data = {}) => res.render(`admin/${view}`, {
  adminNav: view, backUrl: platformPages.has(view) ? '/admin/settings' : view === 'dashboard' ? null : '/admin', ...data
});
const date = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
const coursePublicationActions = [
  'pending-review', 'publication-approved', 'publication-declined', 'publication-cancelled',
  'published', 'admin-published', 'archived', 'admin-archived', 'draft'
];
async function publicationRequests(transaction) {
  const rows = await CourseRevision.findAll({
    where: { action: [...coursePublicationActions, 'module-pending'] },
    attributes: ['id', 'courseId', 'actorId', 'version', 'action'], order: [['id', 'DESC']], transaction
  });
  const latest = new Map();
  const moduleIds = [];
  for (const row of rows) {
    if (row.action === 'module-pending') moduleIds.push(row.id);
    else if (!latest.has(row.courseId)) latest.set(row.courseId, row);
  }
  const modules = moduleIds.length ? await CourseRevision.findAll({ where: { id: moduleIds, action: 'module-pending' }, transaction }) : [];
  return [...latest.values()].filter(row => row.action === 'pending-review').concat(modules);
}
const latestCoursePublication = (course, transaction) => CourseRevision.findOne({
  where: { courseId: course.id, action: coursePublicationActions }, order: [['id', 'DESC']], transaction
});
const pendingForCourse = (course, requests) => requests.filter(request =>
  request.courseId === course.id && request.actorId === course.ownerId &&
  (request.action === 'pending-review' ? !course.published && request.version === course.version :
    course.published || !course.modules.length));

async function archivedCourseCanRepublish(course, transaction) {
  if (!course.ownerId || course.published || !course.modules.length) return false;
  const revision = await CourseRevision.findOne({
    where: { courseId: course.id, version: course.version,
      action: ['archived', 'admin-archived', 'pending-review', 'publication-declined', 'publication-cancelled', 'draft'] },
    order: [['id', 'DESC']], transaction
  });
  if (revision?.snapshot?.archivedForRepublication === true) return true;
  if (revision?.action === 'archived') {
    return Boolean(await CourseRevision.count({
      where: { courseId: course.id, version: course.version, action: ['published', 'admin-published'] }, transaction
    }));
  }
  if (revision?.action !== 'admin-archived') return false;
  const before = await CourseRevision.findOne({
    where: { courseId: course.id, version: course.version - 1, action: 'admin-before-edit' },
    order: [['id', 'DESC']], transaction
  });
  return before?.snapshot?.published === true;
}

export const dashboard = async (req, res) => {
  const [students, faculty, pending, courses, enrollments, completed, credentials, pendingCredentials, recent] = await Promise.all([
    User.count({ where: { role: 'student' } }), User.count({ where: { role: 'faculty' } }), User.count({ where: { role: 'faculty', approvalStatus: 'pending' } }),
    Course.count(), CourseAttempt.count(), CourseAttempt.count({ where: { status: 'completed' } }), Credential.count({ where: { revoked: false } }), CredentialRequest.count({ where: { status: 'pending' } }),
    AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 8 })
  ]);
  const requests = await publicationRequests();
  const submittedCourses = requests.length ? await Course.findAll({
    where: { id: [...new Set(requests.map(request => request.courseId))] },
    attributes: ['id', 'ownerId', 'version', 'published', 'modules']
  }) : [];
  const pendingPublications = submittedCourses.reduce((count, course) => count + pendingForCourse(course, requests).length, 0);
  render(res, 'dashboard', { pendingPublications, title: 'Administration', students, faculty, pending, pendingCredentials, courses, enrollments, completed, credentials, completionRate: enrollments ? Math.round(completed / enrollments * 100) : 0, recent: recent.map(r => ({ ...plain(r), date: date(r.createdAt) })) });
};
export const users = async (req, res) => {
  const where = {};
  if (['admin', 'student', 'faculty', 'staff'].includes(req.query.role)) where.role = req.query.role;
  if (['pending', 'approved', 'rejected'].includes(req.query.approval)) where.approvalStatus = req.query.approval;
  const q = text(req.query.q, 100);
  if (q) where[Op.or] = ['name', 'email', 'studentId', 'facultyId'].map(key => ({ [key]: { [Op.like]: `%${q}%` } }));
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const { rows, count } = await User.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit: 30, offset: (page - 1) * 30 });
  const query = new URLSearchParams({ q, role: text(req.query.role), approval: text(req.query.approval) });
  render(res, 'users', { title: 'Users & faculty approval', users: rows.map(publicUser), sections: (await Section.findAll({ where: { active: true }, order: [['name','ASC']] })).map(plain), q, role: req.query.role, approval: req.query.approval, count, page,
    next: page * 30 < count ? `/admin/users?${query}&page=${page + 1}` : null, previous: page > 1 ? `/admin/users?${query}&page=${page - 1}` : null });
};
export const facultyManagement = async (req, res) => {
  const where = { role: 'faculty' }; if (['pending','approved','returned','rejected'].includes(req.query.approval)) where.approvalStatus = req.query.approval;
  const faculty = await User.findAll({ where, order: [['createdAt','DESC']] });
  const courses = await Course.findAll({ where: { ownerId: { [Op.in]: faculty.map(f => f.id) } } });
  const requests = await CredentialRequest.findAll({ where: { facultyId: { [Op.in]: faculty.map(f => f.id) } } });
  const attempts = await CourseAttempt.findAll({ where: { courseId: { [Op.in]: courses.map(c => c.id) } }, attributes: ['id','courseId'] });
  const credentials = await Credential.findAll({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, revoked: false }, attributes: ['attemptId'] });
  render(res, 'faculty', { title: 'Faculty management', approval: req.query.approval, faculty: faculty.map(f => ({ ...publicUser(f), courses: courses.filter(c => c.ownerId === f.id).map(c => ({ title: c.title, request: requests.find(r => r.courseId === c.id)?.status || 'Not requested', awardsIssued: credentials.filter(cr => attempts.find(a => a.id === cr.attemptId)?.courseId === c.id).length })) })) });
};
export const userDetail = async (req, res) => {
  const user = await User.findByPk(req.params.id); if (!user) return res.status(404).send('User not found.');
  const [profile, attempts, sections] = await Promise.all([StudentProfile.findOne({ where: { userId: user.id } }), CourseAttempt.findAll({ where: { userId: user.id }, order: [['createdAt', 'DESC']] }), Section.findAll({ order: [['name', 'ASC']] })]);
  render(res, 'user', { title: 'Account details', backUrl: '/admin/users', account: publicUser(user), profile: plain(profile), genders, sections: sections.map(plain),
    attempts: attempts.map(a => ({ id: a.id, title: a.snapshot.title, attempt: a.attemptNumber, status: a.status, score: a.finalScore, date: date(a.createdAt) })), isSelf: req.user.id === user.id, canManageAdmins: req.user.email === ownerEmail() });
};
function accountValues(body) {
  const role = text(body.role);
  if (!['student', 'faculty', 'admin'].includes(role)) fail('Select a valid role.');
  const name = text(body.name, 100); if (name.length < 2) fail('Enter the full name.');
  const studentId = role === 'student' ? text(body.studentId, 40) : null;
  const facultyId = role === 'faculty' ? text(body.facultyId, 40) : null;
  if ((role === 'student' && !/^[\w-]{3,40}$/.test(studentId)) || (role === 'faculty' && !/^[\w-]{3,40}$/.test(facultyId))) fail('Enter a valid institutional ID for this role.');
  const gender = role === 'student' ? text(body.gender, 30) : null;
  if (role === 'student' && !genders.includes(gender)) fail('Select a student gender.');
  const section = role === 'student' ? text(body.section, 60) : null;
  if (role === 'student' && !section) fail('Select a section.');
  return { name, role, studentId, facultyId, gender, section, active: body.active === 'true', approvalStatus: role === 'faculty' ? (['approved', 'pending', 'rejected'].includes(body.approvalStatus) ? body.approvalStatus : 'pending') : 'approved' };
}
export const saveUser = async (req, res) => {
  const data = accountValues(req.body);
  try {
    await sequelize.transaction(async transaction => {
      // Serialize administrator changes so the last active admin cannot be removed concurrently.
      await Setting.findAll({ where: { key: 'institutionName' }, transaction, lock: transaction.LOCK.UPDATE });
      const user = await User.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('User not found.');
      if ((data.role === 'faculty' && user.role !== 'faculty') || (user.role === 'faculty' && data.approvalStatus !== user.approvalStatus)) fail('Faculty registrations and review decisions must be handled through Faculty Management.');
      if ((user.role === 'admin' || data.role === 'admin') && req.user.email !== ownerEmail()) fail('Only the owner can manage administrator roles.');
      if ((user.id === req.user.id || user.email === ownerEmail()) && (!data.active || data.role !== 'admin')) fail('You cannot disable or demote yourself or the system owner.');
      if (data.section && !await Section.findOne({ where: { name: data.section }, transaction })) fail('Section not found.');
      if (user.role === 'admin' && (!data.active || data.role !== 'admin') && await User.count({ where: { role: 'admin', active: true }, transaction }) <= 1) fail('At least one active administrator is required.');
      await user.update({ ...data, ...(user.active && !data.active ? { sessionVersion: user.sessionVersion + 1 } : {}) }, { transaction });
      await audit(req.user.id, 'user.updated', 'user', user.id, { role: data.role, active: data.active, approval: data.approvalStatus }, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That institutional ID is already assigned.'); throw error; }
  req.flash('success_msg', 'Account updated.'); res.redirect(`/admin/users/${req.params.id}`);
};
export const createUser = async (req, res) => {
  const data = accountValues({ ...req.body, active: 'true' });
  if (!['student', 'faculty'].includes(data.role)) fail('Only Student and Faculty accounts can be provisioned here.');
  const address = email(req.body.email); const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address === ownerEmail()) fail('Use a valid unreserved email.');
  if (typeof password !== 'string' || password.length < 14 || Buffer.byteLength(password) > 72) fail('Use an initial password of at least 14 characters, at most 72 bytes.');
  if (data.section && !await Section.findOne({ where: { name: data.section, active: true } })) fail('Select an active section.');
  const facultyProfile = data.role === 'faculty' ? { facultyPosition: text(req.body.facultyPosition, 120), facultyEducation: text(req.body.facultyEducation, 200), facultyQualifications: text(req.body.facultyQualifications, 2000) } : {};
  if (data.role === 'faculty' && (!facultyProfile.facultyPosition || !facultyProfile.facultyEducation)) fail('Enter the faculty Position and Degree.');
  if (data.role === 'faculty') data.approvalStatus = 'approved';
  try {
    await sequelize.transaction(async transaction => {
      const user = await User.create({ ...data, ...facultyProfile, email: address, password: await bcrypt.hash(password, 12) }, { transaction });
      await audit(req.user.id, 'user.created', 'user', user.id, { role: data.role }, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('Email or institutional ID already exists.'); throw error; }
  req.flash('success_msg', `${data.role === 'faculty' ? 'Faculty' : 'Student'} account created. Share the initial password through your approved private channel.`); res.redirect(data.role === 'faculty' ? '/admin/faculty' : '/admin/users');
};
export const approveFaculty = async (req, res) => {
  const status = text(req.body.status), remarks = text(req.body.remarks, 1000); if (!['approved', 'rejected', 'returned'].includes(status)) fail('Invalid approval decision.');
  if (status === 'approved' && ['verifyIdentity','verifyQualifications'].some(key => req.body[key] !== 'yes')) fail('Complete the faculty registration review checklist before approval.');
  if (status !== 'approved' && remarks.length < 4) fail('Enter review feedback for returned or rejected registrations.');
  await sequelize.transaction(async transaction => {
    const user = await User.findOne({ where: { id: req.params.id, role: 'faculty' }, transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('Faculty account not found.');
    await user.update({ approvalStatus: status, facultyReviewedBy: req.user.id, facultyReviewedAt: new Date(), facultyReviewRemarks: remarks || null }, { transaction });
    await Notification.create({ userId: user.id, title: 'Faculty account review', message: `Your faculty registration was ${status}.${remarks ? ` Feedback: ${remarks}` : ''}`, href: '/faculty/profile' }, { transaction });
    await audit(req.user.id, `faculty.${status}`, 'user', user.id, { remarks }, transaction);
  });
  req.flash('success_msg', `Faculty account ${status}.`); res.redirect('/admin/faculty');
};
export const setFacultyActive = async (req, res) => {
  const active = req.body.active === 'true';
  await sequelize.transaction(async transaction => {
    const user = await User.findOne({ where: { id: req.params.id, role: 'faculty' }, transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('Faculty account not found.', 404);
    await user.update({ active, sessionVersion: active ? user.sessionVersion : user.sessionVersion + 1 }, { transaction });
    await audit(req.user.id, active ? 'faculty.activated' : 'faculty.deactivated', 'user', user.id, {}, transaction);
  });
  req.flash('success_msg', `Faculty account ${active ? 'activated' : 'deactivated'}. Existing courses and records were preserved.`); res.redirect('/admin/faculty');
};
export const resetPassword = async (req, res) => {
  const password = req.body.newPassword;
  if (typeof password !== 'string' || password.length < 14 || Buffer.byteLength(password) > 72) fail('Use at least 14 characters, at most 72 bytes.');
  await sequelize.transaction(async transaction => {
    const user = await User.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('Account not found.');
    if (user.id === req.user.id) fail('Use My account to change your own password.');
    if (user.role === 'admin' && req.user.email !== ownerEmail()) fail('Only the owner can reset administrator passwords.');
    await user.update({ password: await bcrypt.hash(password, 12), sessionVersion: user.sessionVersion + 1 }, { transaction });
    await audit(req.user.id, 'user.password_reset', 'user', user.id, {}, transaction);
  });
  req.flash('success_msg', 'Password reset. Previous login sessions were invalidated.'); res.redirect(`/admin/users/${req.params.id}`);
};
export const sections = async (req, res) => render(res, 'sections', { title: 'Manage sections', sections: (await Section.findAll({ order: [['name', 'ASC']] })).map(plain) });
export const saveSection = async (req, res) => {
  const name = text(req.body.name, 60), academicYear = text(req.body.academicYear, 30);
  if (!name || !/^\d{4}-\d{4}$/.test(academicYear)) fail('Enter section name and academic year (2026-2027).');
  try {
    await sequelize.transaction(async transaction => {
      let section = req.params.id ? await Section.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (req.params.id && !section) fail('Section not found.');
      const data = { name, academicYear, facultyId: null, active: req.body.active === 'true' };
      if (section) { const oldName = section.name; await section.update(data, { transaction }); if (oldName !== name) await User.update({ section: name }, { where: { role: 'student', section: oldName }, transaction }); }
      else section = await Section.create(data, { transaction });
      await audit(req.user.id, 'section.saved', 'section', section.id, {}, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That section already exists.'); throw error; }
  req.flash('success_msg', 'Section saved.'); res.redirect('/admin/sections');
};
export const deleteSection = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const section = await Section.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!section) fail('Section not found.', 404);
    const students = await User.count({ where: { role: 'student', section: section.name }, transaction });
    const [assignments, corrections] = await Promise.all([CourseAssignment.count({ where: { sectionId: section.id }, transaction }), ProfileCorrection.count({ where: { section: section.name }, transaction })]);
    if (students || assignments || corrections) fail('This section is linked to student, correction, or course records. Deactivate it to preserve those records.');
    if (section.facultyId) await section.update({ facultyId: null }, { transaction });
    await audit(req.user.id, 'section.deleted', 'section', section.id, { name: section.name }, transaction);
    await section.destroy({ transaction });
  });
  req.flash('success_msg', 'Section deleted.'); res.redirect('/admin/sections');
};
const duplicateTitle = title => title.trim().replace(/\s+/g, ' ').toLowerCase();
export const deleteDuplicateCourse = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!course || course.published || !course.ownerId) fail('Only an unpublished faculty duplicate can be removed.');
    const others = await Course.findAll({ where: { ownerId: course.ownerId }, transaction });
    if (!others.some(row => row.published && duplicateTitle(row.title) === duplicateTitle(course.title))) {
      fail('A published course with the same title and owner is required.');
    }
    const where = { courseId: course.id };
    const [attempts, awards, assignments, savedCourses, savedModules, revisions, jobs, publicationHistory] = await Promise.all([
      CourseAttempt.count({ where, transaction }), CredentialRequest.count({ where, transaction }),
      CourseAssignment.count({ where, transaction }), SavedCourse.count({ where, transaction }),
      SavedModule.count({ where, transaction }), publicationRequests(transaction),
      AiJob.findAll({ where: { userId: course.ownerId, status: ['queued', 'running', 'review'] },
        attributes: ['courseId', 'state'], transaction }),
      CourseRevision.count({ where: { ...where, action: ['published', 'module-published', 'admin-published', 'publication-approved'] }, transaction })
    ]);
    const courses = await Course.findAll({ attributes: ['id', 'prerequisites'], transaction });
    if (attempts || awards || assignments || savedCourses || savedModules || publicationHistory ||
        jobs.some(job => job.courseId === course.id || Number(job.state?.options?.destinationId) === course.id) ||
        pendingForCourse(course, revisions).length || courses.some(row => row.id !== course.id &&
          (row.prerequisites || []).some(id => Number(id) === course.id))) {
      fail('This duplicate has linked records or pending work and must be preserved.');
    }
    await CourseRevision.destroy({ where, transaction });
    await AiJob.update({ courseId: null }, { where, transaction });
    await audit(req.user.id, 'course.duplicate_deleted', 'course', course.id, { title: course.title }, transaction);
    await course.destroy({ transaction });
  });
  req.flash('success_msg', 'Unpublished duplicate deleted.');
  res.redirect('/admin/courses');
};
export const courses = async (req, res) => {
  const [faculty, courses, submissions] = await Promise.all([
    User.findAll({ where: { role: 'faculty', active: true, approvalStatus: 'approved' }, attributes: ['id', 'name'] }),
    Course.findAll({ order: [['title', 'ASC']] }),
    publicationRequests()
  ]);
  const archived = await CourseRevision.findAll({ where: { action: 'module-archived' } });
  const reviewRows = await Promise.all(courses.map(async course => {
    const requests = pendingForCourse(course, submissions);
    return {
      ...plain(course), duplicateDraft: !course.published && !requests.length && courses.some(row =>
        row.published && row.ownerId === course.ownerId && duplicateTitle(row.title) === duplicateTitle(course.title)), moduleCount: course.modules.length, hasPending: requests.length > 0,
      questionsByModule: Object.groupBy(course.questions, question => question.moduleId),
      pendingReview: requests.some(row => row.action === 'pending-review'),
      moduleSubmissions: requests.filter(row => row.action === 'module-pending').map(plain),
      archivedModules: archived.filter(row => row.courseId === course.id && row.snapshot?.module &&
        (course.published || !course.modules.length) &&
        !course.modules.some(module => module.id === row.snapshot.module.id) &&
        !requests.some(request => request.snapshot?.module?.id === row.snapshot.module.id)).map(plain),
      canRepublish: !requests.length && await archivedCourseCanRepublish(course)
    };
  }));
  const institutionName = (await Setting.findOne({ where: { key: 'institutionName' } }))?.value;
  const pendingCredentials = reviewRows.filter(course => (course.pendingReview || course.moduleSubmissions.length) && course.certificateEnabled);
  const signatures = new Map(await Promise.all([...new Set(pendingCredentials.map(course => course.ownerId))].map(async id => [id, await facultySignature(id)])));
  const requests = await CredentialRequest.findAll({ where: { courseId: pendingCredentials.map(course => course.id) } });
  for (const course of pendingCredentials) {
    course.signature = signatures.get(course.ownerId) || requests.find(request =>
      request.courseId === course.id && request.facultyId === course.ownerId && request.status !== 'rejected')?.facultySignature;
    course.facultyName = faculty.find(owner => owner.id === course.ownerId)?.name;
  }
  const pendingCount = reviewRows.reduce((count, course) => count + Number(course.pendingReview) + course.moduleSubmissions.length, 0);
  const pendingOnly = req.query.status === 'pending';
  render(res, 'courses', {
    title: 'Course oversight', institutionName, faculty: faculty.map(plain), domains, pendingCount, pendingOnly,
    courses: reviewRows.filter(course => !pendingOnly || course.pendingReview || course.moduleSubmissions.length)
      .sort((first, second) => Number(second.hasPending) - Number(first.hasPending))
  });
};
async function notifyPublication(course, owner, module, transaction) {
  const title = module?.title || course.title;
  const href = `/student/courses/${course.id}${module ? `#module-${module.id}` : ''}`;
  await Notification.create({
    userId: owner.id, title: module ? 'Module publication approved' : 'Course publication approved',
    message: `${title} was approved and published on ${date(new Date())}.`,
    href: `/faculty/courses?course=${course.id}`
  }, { transaction });
  const learners = await User.findAll({ where: { role: 'student', active: true }, attributes: ['id'], transaction });
  await Notification.bulkCreate(learners.map(user => ({
    userId: user.id, title: module ? 'New module published' : 'New course published',
    message: `${owner.name} published ${title}${module ? ` in ${course.title}` : ''} on ${date(new Date())}.`, href
  })), { transaction });
}
async function restoreModule(course, snapshot, adminId, transaction) {
  const { module, questions } = snapshot;
  const existing = course.modules.find(item => item.id === module.id);
  const duplicate = duplicateModule(course.modules, module, module.id, existing);
  if (duplicate) fail(duplicateModuleMessage(duplicate), 409);
  const normalized = course.modules.map((item, index) => ({ ...item, number: item.number ?? index + 1 }));
  const maxNumber = Math.max(0, ...normalized.map(item => item.number));
  const storedNumber = normalized.find(item => item.id === module.id)?.number;
  const number = storedNumber ?? (module.number && !normalized.some(item => item.number === module.number) ? module.number : maxNumber + 1);
  const reviewed = { ...module, number, lessons: module.lessons.map(lesson => ({ ...lesson, sourceReviewed: true })) };
  const data = courseInput({
    ...plain(course),
    modules: (existing ? normalized.map(item => item.id === module.id ? reviewed : item) : [...normalized, reviewed]).sort((a, b) => a.number - b.number),
    questions: [...course.questions.filter(question => question.moduleId !== module.id), ...questions.map(question => ({ ...question, reviewed: true }))]
  });
  publishCheck(data);
  if (!await facultySignature(course.ownerId, transaction)) fail('The faculty signature is missing. Save it in My Profile before publishing.');
  if (course.certificateEnabled && !await preparePublicationCredential(course, transaction, adminId)) fail('The faculty signature is missing.');
  await course.update({ modules: data.modules, questions: data.questions, version: course.version + 1, published: true, awardsApproved: course.certificateEnabled }, { transaction });
}

export const approvePublication = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (req.body.revisionId) {
      if (!course?.ownerId || (!course.published && course.modules.length)) fail('This course is unavailable for module publication.');
      const revision = await CourseRevision.findOne({
        where: { id: req.body.revisionId, courseId: course.id, actorId: course.ownerId, action: 'module-pending' }, transaction
      });
      const owner = await User.findOne({ where: { id: course.ownerId, role: 'faculty', active: true, approvalStatus: 'approved' }, transaction });
      if (!revision || !owner) fail('This module is no longer pending review.');
      await restoreModule(course, revision.snapshot, req.user.id, transaction);
      const { module } = revision.snapshot;
      await revision.update({ action: 'module-published' }, { transaction });
      const archives = await CourseRevision.findAll({ where: { courseId: course.id, action: 'module-archived' }, transaction });
      for (const row of archives) if (row.snapshot?.module?.id === module.id) await row.update({ action: 'module-restored' }, { transaction });
      await notifyPublication(course, owner, module, transaction);
      await audit(req.user.id, 'module.published', 'course', course.id, { moduleId: module.id }, transaction);
      return;
    }
    if (!course || course.published || !course.ownerId || Number(req.body.version) !== course.version) fail('Review the latest faculty submission before publishing.');
    const submission = await latestCoursePublication(course, transaction);
    if (submission?.action !== 'pending-review' || submission.version !== course.version) {
      fail('This course is awaiting a faculty submission.');
    }
    const owner = await User.findOne({ where: { id: course.ownerId, role: 'faculty', active: true, approvalStatus: 'approved' }, transaction });
    if (!owner || submission.actorId !== owner.id) fail('The current faculty owner must submit the course for approval.');
    if (!await facultySignature(course.ownerId, transaction)) fail('The faculty signature is missing. Save it in My Profile before publishing.');
    publishCheck(plain(course));
    if (course.certificateEnabled && !await preparePublicationCredential(course, transaction, req.user.id)) fail('The faculty signature is missing. Ask the faculty member to save their signature in My Profile before publishing.');
    await course.update({ published: true, awardsApproved: course.certificateEnabled }, { transaction });
    await submission.update({ action: 'publication-approved' }, { transaction });
    if (course.certificateEnabled) {
      const attempts = await CourseAttempt.findAll({ where: { courseId: course.id, status: 'ongoing' }, transaction, lock: transaction.LOCK.UPDATE });
      for (const attempt of attempts) await attempt.update({
        snapshot: { ...attempt.snapshot, awardsApproved: attempt.snapshot.certificateEnabled !== false }
      }, { transaction });
    }
    await CourseRevision.create({ courseId: course.id, actorId: req.user.id, version: course.version, action: 'admin-published', snapshot: plain(course) }, { transaction });
    await audit(req.user.id, 'course.published', 'course', course.id, { version: course.version }, transaction);
    await notifyPublication(course, owner, null, transaction);
  });
  req.flash('success_msg', 'Course approved and published.');
  res.redirect('/admin/courses');
};
export const republishCourse = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!course?.ownerId) fail('Course not found.');
    const owner = await User.findOne({
      where: { id: course.ownerId, role: 'faculty', active: true, approvalStatus: 'approved' }, transaction
    });
    if (!owner) fail('An active approved faculty owner is required to republish.');
    if (req.body.revisionId) {
      if (!course.published && course.modules.length) fail('Republish the archived course first.');
      const revision = await CourseRevision.findOne({
        where: { id: req.body.revisionId, courseId: course.id, action: 'module-archived' }, transaction
      });
      const module = revision?.snapshot?.module;
      if (!module || course.modules.some(item => item.id === module.id)) fail('This module is no longer archived.');
      const pending = await CourseRevision.findAll({ where: { courseId: course.id, action: 'module-pending' }, transaction });
      if (pendingForCourse(course, pending).some(row => row.snapshot?.module?.id === module.id)) {
        fail('Resolve the pending module submission first.');
      }
      await restoreModule(course, revision.snapshot, req.user.id, transaction);
      await revision.update({ action: 'module-restored' }, { transaction });
      await notifyPublication(course, owner, module, transaction);
      await audit(req.user.id, 'module.republished', 'course', course.id, { moduleId: module.id }, transaction);
      return;
    }
    if (Number(req.body.version) !== course.version || !await archivedCourseCanRepublish(course, transaction)) {
      fail('This course is no longer eligible for republication.');
    }
    if (!await facultySignature(course.ownerId, transaction)) fail('The faculty signature is missing. Save it in My Profile before publishing.');
    publishCheck(plain(course));
    if (course.certificateEnabled && !await preparePublicationCredential(course, transaction, req.user.id)) {
      fail('The faculty signature is missing.');
    }
    await course.update({ published: true, version: course.version + 1, awardsApproved: course.certificateEnabled }, { transaction });
    await CourseRevision.create({
      courseId: course.id, actorId: req.user.id, version: course.version, action: 'admin-published', snapshot: plain(course)
    }, { transaction });
    await notifyPublication(course, owner, null, transaction);
    await audit(req.user.id, 'course.republished', 'course', course.id, { version: course.version }, transaction);
  });
  req.flash('success_msg', 'Republished and visible in the student catalog.');
  res.redirect(`/admin/courses#course-${req.params.id}`);
};
export const declinePublication = async (req, res) => {
  const reason = text(req.body.reason, 1000);
  if (!reason) fail('Enter a reason for declining this submission.');
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!course?.ownerId) fail('Course submission not found.');
    const moduleSubmission = Boolean(req.body.revisionId);
    const where = { courseId: course.id, actorId: course.ownerId };
    if (moduleSubmission) {
      Object.assign(where, { id: req.body.revisionId, action: 'module-pending' });
    } else {
      if (course.published || Number(req.body.version) !== course.version) fail('This course is no longer pending review.');
      Object.assign(where, { version: course.version, action: 'pending-review' });
    }
    const submission = moduleSubmission
      ? await CourseRevision.findOne({ where, transaction })
      : await latestCoursePublication(course, transaction);
    if (!submission || submission.actorId !== course.ownerId || submission.action !== where.action ||
        (!moduleSubmission && submission.version !== course.version)) fail('This submission is no longer pending review.');
    const title = moduleSubmission ? submission.snapshot.module.title : course.title;
    await submission.update({
      action: moduleSubmission ? 'module-draft' : 'publication-declined',
      snapshot: { ...submission.snapshot, declineReason: reason }
    }, { transaction });
    await Notification.create({
      userId: course.ownerId, title: 'Publication declined',
      message: `${title}: ${reason}`, href: `/faculty/courses?list=drafts&course=${course.id}`
    }, { transaction });
    await audit(req.user.id, 'publication.declined', 'course', course.id, { revisionId: submission.id, reason }, transaction);
  });
  req.flash('success_msg', 'Submission declined and returned to Faculty Drafts.');
  res.redirect('/admin/courses?status=pending');
};
export const saveCourse = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!course) fail('Course not found.');
    const unpublishing = req.body.unpublish === 'yes';
    if (unpublishing && req.body.version !== undefined && Number(req.body.version) !== course.version) fail('The course changed. Reload before unpublishing.');
    const settings = unpublishing ? {} : {
      title: text(req.body.title, 160), description: text(req.body.description, 2000),
      domain: text(req.body.domain, 60), passingScore: Number(req.body.passingScore)
    };
    if (!unpublishing && (!settings.title || !domains.includes(settings.domain) ||
        !Number.isInteger(settings.passingScore) || settings.passingScore < 50 || settings.passingScore > 100)) {
      fail('Check course title, area and passing score (50-100).');
    }
    const latest = !course.published && await latestCoursePublication(course, transaction);
    if (latest?.action === 'pending-review' && latest.version === course.version) fail('Resolve the pending submission first.');
    const published = !unpublishing && (course.published || !course.ownerId && req.body.published === 'true');
    const archivedForRepublication = !published && (course.published || await archivedCourseCanRepublish(course, transaction));
    if (published) publishCheck({ ...plain(course), outcomes: course.outcomes?.length ? course.outcomes : course.starter ? ['Starter learning outcomes in lessons'] : [], questions: course.questions.map(q => course.starter ? { ...q, reviewed: true } : q) });
    await CourseRevision.create({ courseId: course.id, actorId: req.user.id, version: course.version, action: 'admin-before-edit', snapshot: plain(course) }, { transaction });
    await course.update({ ...settings, published, version: course.version + 1 }, { transaction });
    await CourseRevision.create({ courseId: course.id, actorId: req.user.id, version: course.version, action: course.published ? 'admin-published' : 'admin-archived', snapshot: { ...plain(course), archivedForRepublication } }, { transaction });
    await audit(req.user.id, 'course.updated', 'course', course.id, { version: course.version, published: course.published }, transaction);
  });
  req.flash('success_msg', 'Course updated. Existing learning attempts retain their original requirements.'); res.redirect('/admin/courses');
};
export const credentials = async (req, res) => {
  const rows = await Credential.findAll({ order: [['issuedAt', 'DESC']], limit: 200 });
  render(res, 'credentials', { title: 'Certificates & badges', credentials: rows.map(c => ({ ...plain(c), date: date(c.issuedAt) })) });
};
export const credentialApprovals = async (req, res) => {
  const status = ['pending','returned','approved','rejected'].includes(req.query.status) ? req.query.status : '';
  const where = status ? { status } : {};
  const requests = await CredentialRequest.findAll({ where, order: [['updatedAt','DESC']], limit: 300 });
  const courses = await Course.findAll({ where: { id: { [Op.in]: requests.map(r => r.courseId) } } });
  const faculty = await User.findAll({ where: { id: { [Op.in]: requests.map(r => r.facultyId) } } });
  const settings = Object.fromEntries((await Setting.findAll({ where: { key: ['institutionName'] } })).map(s => [s.key, s.value]));
  render(res, 'credentialApprovals', { title: 'Credential approvals', status, ...settings, requests: requests.map(r => ({ ...plain(r), course: plain(courses.find(c => c.id === r.courseId)), faculty: publicUser(faculty.find(f => f.id === r.facultyId)) })) });
};
export const reviewCredential = async (req, res) => {
  const status = text(req.body.status), remarks = text(req.body.remarks, 1000);
  if (!['approved','returned','rejected'].includes(status)) fail('Choose approve, return or reject.');
  if (status !== 'approved' && remarks.length < 4) fail('Enter feedback when returning or rejecting a request.');
  if (status === 'approved' && ['verifyCourse','verifyFacultySignature','verifyTemplate'].some(key => req.body[key] !== 'yes')) fail('Complete each credential review checklist item before approving.');
  await sequelize.transaction(async transaction => {
    const request = await CredentialRequest.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!request) fail('Credential request not found.');
    const course = await Course.findOne({ where: { id: request.courseId, ownerId: request.facultyId }, transaction, lock: transaction.LOCK.UPDATE }); if (!course) fail('The course is no longer owned by this faculty member.');
    await request.update({ status, remarks: remarks || null, reviewedBy: req.user.id, reviewedAt: new Date() }, { transaction });
    await course.update({ awardsApproved: status === 'approved' }, { transaction });
    const facultyAccount = await User.findByPk(request.facultyId, { transaction });
    if (status === 'approved' && facultyAccount?.approvalStatus !== 'approved') fail('Approve the faculty registration before approving its credentials.');
    const attempts = await CourseAttempt.findAll({ where: { courseId: course.id }, transaction, lock: transaction.LOCK.UPDATE });
    for (const attempt of attempts) {
      const snapshot = { ...attempt.snapshot, awardsApproved: status === 'approved' && attempt.snapshot.certificateEnabled !== false };
      await attempt.update({ snapshot }, { transaction });
      if (status === 'approved' && snapshot.awardsApproved && !snapshot.modules?.some(module => Array.isArray(module.skills)) && attempt.status === 'completed' && attempt.finalScore >= snapshot.passingScore) {
        const policy = attempt.snapshot.policy || {}, modules = attempt.snapshot.modules || [], tasks = (attempt.snapshot.tasks || []).filter(task => task.required !== false), practicals = tasks.length ? await PracticalSubmission.findAll({ where: { attemptId: attempt.id, status: 'graded' }, transaction }) : [];
        const quizAverage = modules.length ? modules.reduce((sum, module) => sum + (attempt.quizScores?.[module.id] || 0), 0) / modules.length : attempt.finalScore;
        const practicalAverage = tasks.length ? practicals.filter(submission => tasks.some(task => task.id === submission.taskId)).reduce((sum, submission) => sum + (submission.grade || 0), 0) / tasks.length : 0;
        const weighted = Math.round(quizAverage * (policy.quizWeight ?? 0) / 100 + attempt.finalScore * (policy.finalWeight ?? 100) / 100 + practicalAverage * (policy.practicalWeight ?? 0) / 100);
        const [credential, created] = await Credential.findOrCreate({ where: { attemptId: attempt.id, moduleId: '' }, defaults: { userId: attempt.userId, courseTitle: attempt.snapshot.title, recipientName: (await User.findByPk(attempt.userId, { transaction }))?.name || 'Learner', courseVersion: attempt.courseVersion, score: weighted, stars: starsFor(weighted), issuedAt: attempt.completedAt || new Date(), facultySignature: request.facultySignature, facultyName: facultyAccount?.name || null, facultyPosition: facultyAccount?.facultyPosition || 'Course Faculty', badgeLabel: request.badge?.label || 'Course completion' }, transaction });
        if (!created && !credential.revoked) await credential.update({ facultySignature: request.facultySignature, facultyName: facultyAccount?.name || null, facultyPosition: facultyAccount?.facultyPosition || 'Course Faculty', badgeLabel: request.badge?.label || credential.badgeLabel || 'Course completion' }, { transaction });
        if (created) await Notification.create({ userId: attempt.userId, title: 'Certificate and badge approved', message: `Your completion of ${course.title} now qualifies for its approved certificate and badge.`, href: '/student/achievements' }, { transaction });
      }
    }
    await Notification.create({ userId: request.facultyId, title: 'Credential configuration reviewed', message: `Your request for ${course.title} was ${status}.${remarks ? ` Feedback: ${remarks}` : ''}`, href: '/faculty/credentials' }, { transaction });
    await audit(req.user.id, `credential.${status}`, 'course', course.id, { requestId: request.id, remarks }, transaction);
  });
  req.flash('success_msg', `Credential request ${status}.`); res.redirect('/admin/credential-approvals');
};
export const revokeCredential = async (req, res) => {
  const reason = text(req.body.reason, 300); if (reason.length < 5) fail('Enter a revocation reason.');
  await sequelize.transaction(async transaction => {
    const credential = await Credential.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!credential) fail('Credential not found.');
    await credential.update({ revoked: true }, { transaction });
    await audit(req.user.id, 'credential.revoked', 'credential', credential.id, { reason }, transaction);
  });
  req.flash('success_msg', 'Credential revoked. Public verification now shows its revoked status.'); res.redirect('/admin/credentials');
};
export const announcements = async (req, res) => render(res, 'announcements', { title: 'Announcements', announcements: (await Announcement.findAll({ order: [['createdAt', 'DESC']], limit: 100 })).map(a => ({ ...plain(a), date: date(a.createdAt) })) });
export const saveAnnouncement = async (req, res) => {
  const title = text(req.body.title, 160), body = text(req.body.body, 3000), audience = text(req.body.audience);
  if (!title || !body || !['all', 'student', 'faculty'].includes(audience)) fail('Enter a title, message and audience.');
  await sequelize.transaction(async transaction => {
    let row = req.params.id ? await Announcement.findByPk(req.params.id, { transaction }) : null;
    if (req.params.id && !row) fail('Announcement not found.');
    const data = { title, body, audience, published: req.body.published === 'true', authorId: req.user.id };
    if (row) await row.update(data, { transaction }); else row = await Announcement.create(data, { transaction });
    await audit(req.user.id, 'announcement.saved', 'announcement', row.id, {}, transaction);
  });
  req.flash('success_msg', 'Announcement saved. Published notices appear in the selected user portals.'); res.redirect('/admin/announcements');
};
export const careerPaths = async (req, res) => render(res, 'careers', { title: 'Career pathway rules', paths: (await CareerPath.findAll({ order: [['title', 'ASC']] })).map(p => ({ ...plain(p), domainOptions: domains.map(name => ({ name, chosen: p.required.includes(name) })) })), domains });
export const saveCareer = async (req, res) => {
  const title = text(req.body.title, 160), required = [...new Set(Array.isArray(req.body.required) ? req.body.required : [req.body.required])].filter(d => domains.includes(d));
  if (!title || !required.length) fail('Enter a title and at least one competency area.');
  try {
    await sequelize.transaction(async transaction => {
      const data = { title, focus: text(req.body.focus, 160), qualifications: text(req.body.qualifications, 1500), required, active: req.body.active === 'true' };
      let row = req.params.id ? await CareerPath.findByPk(req.params.id, { transaction }) : null;
      if (req.params.id && !row) fail('Career path not found.');
      if (row) await row.update(data, { transaction }); else row = await CareerPath.create(data, { transaction });
      await audit(req.user.id, 'career.saved', 'career', row.id, {}, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That pathway title already exists.'); throw error; }
  req.flash('success_msg', 'Career pathway saved.'); res.redirect('/admin/careers');
};
export const settings = async (req, res) => render(res, 'settings', { title: 'System settings', portalSettings: Object.fromEntries((await Setting.findAll()).map(s => [s.key, s.value])), googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), aiConfigured: (await courseAiConfiguration()).ready, aiStatus: await courseAiConfiguration() });
export const saveSettings = async (req, res) => {
  const values = { certificateTemplate: 'classic', institutionName: text(req.body.institutionName, 160), academicYear: text(req.body.academicYear, 30), certificateFooter: text(req.body.certificateFooter, 250), registrationEnabled: req.body.registrationEnabled === 'true' ? 'true' : 'false', facultyRegistrationEnabled: req.body.facultyRegistrationEnabled === 'true' ? 'true' : 'false' };
  if (!values.institutionName || !/^\d{4}-\d{4}$/.test(values.academicYear)) fail('Enter an institution and academic year.');
  await sequelize.transaction(async transaction => {
    for (const [key, value] of Object.entries(values)) await Setting.upsert({ key, value }, { transaction });
    await audit(req.user.id, 'settings.updated', 'system', 'settings', {}, transaction);
  });
  req.flash('success_msg', 'Settings saved.'); res.redirect('/admin/settings');
};
export const auditLogs = async (req, res) => {
  const where = {}, q = text(req.query.q, 100), actor = text(req.query.actor, 20), from = text(req.query.from, 10), to = text(req.query.to, 10);
  if (q) where.action = { [Op.like]: `%${q}%` };
  if (/^\d+$/.test(actor)) where.actorId = Number(actor);
  if (from || to) where.createdAt = { ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { [Op.gte]: new Date(`${from}T00:00:00`) } : {}), ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { [Op.lt]: new Date(new Date(`${to}T00:00:00`).getTime() + 86400000) } : {}) };
  const logs = await AuditLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 300 });
  render(res, 'audit', { title: 'Activity & audit logs', q, actor, from, to, logs: logs.map(l => ({ ...plain(l), date: date(l.createdAt), detail: JSON.stringify(l.details) })) });
};
export const reports = async (req, res) => {
  const attempts = await CourseAttempt.findAll({ include: [{ model: User, attributes: ['id', 'name', 'section'] }], order: [['createdAt', 'DESC']], limit: 500 });
  const diagnostics = await Assessment.findAll({ include: [{ model: User, attributes: ['name', 'section'] }], order: [['createdAt', 'DESC']], limit: 500 });
  const [students, allAttempts, allDiagnostics, practicals] = await Promise.all([
    User.findAll({ where: { role: 'student' }, attributes: ['id','section'] }),
    CourseAttempt.findAll({ attributes: ['id','userId','courseId','snapshot','status','completedAt','finalScore'] }),
    Assessment.findAll({ attributes: ['userId','scores','createdAt'], order: [['createdAt','DESC']] }),
    PracticalSubmission.findAll({ where: { status: 'graded' }, attributes: ['attemptId','taskId','grade'] })
  ]);
  const summary = summarizeLearning(students, allAttempts, allDiagnostics, practicals);
  render(res, 'reports', { ...summary, title: 'Learning & readiness reports', attempts: attempts.map(a => ({ ...plain(a), title: a.snapshot.title, date: date(a.createdAt) })), diagnostics: diagnostics.map(d => ({ ...plain(d), date: date(d.createdAt) })) });
};
export const exportReport = async (req, res) => {
  const options = { include: [{ model: User, attributes: ['name', 'section'] }], order: [['createdAt', 'DESC']] };
  const [attempts, diagnostics] = await Promise.all([CourseAttempt.findAll(options), Assessment.findAll(options)]);
  return sendWorkbook(res, 'CareerBridge-learning-report.xlsx', [{
    name: 'Course activity',
    headers: ['Student', 'Section', 'Course', 'Attempt', 'Status', 'Final score (%)', 'Active minutes', 'Started'],
    rows: attempts.map(a => [a.User?.name, a.User?.section, a.snapshot.title, a.attemptNumber, a.status, a.finalScore, Math.floor(a.activeSeconds / 60), date(a.createdAt)])
  }, {
    name: 'Knowledge diagnostics',
    headers: ['Student', 'Section', 'Date', 'Score (%)'],
    rows: diagnostics.map(d => [d.User?.name, d.User?.section, date(d.createdAt), d.score])
  }]);
};
export const account = (req, res) => render(res, 'account', { title: 'My administrator account', googleConnected: Boolean(req.user.googleId), hasPassword: Boolean(req.user.password), googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
export const changePassword = async (req, res) => {
  const password = req.body.newPassword;
  if (typeof password !== 'string' || password.length < 14 || Buffer.byteLength(password) > 72 || password !== req.body.confirmPassword) fail('Use matching passwords of 14+ characters, at most 72 bytes.');
  const recentGoogle = req.session.authMethod === 'google' && Date.now() - req.session.loginAt < 10 * 60 * 1000;
  if (!recentGoogle && (!req.user.password || typeof req.body.currentPassword !== 'string' || !await bcrypt.compare(req.body.currentPassword, req.user.password))) fail('Enter your current password, or sign in again using Google before setting one.');
  await req.user.update({ password: await bcrypt.hash(password, 12), sessionVersion: req.user.sessionVersion + 1 });
  req.session.sessionVersion = req.user.sessionVersion;
  await audit(req.user.id, 'account.password_changed', 'user', req.user.id);
  req.flash('success_msg', 'Password updated. Other login sessions have been invalidated.'); res.redirect('/admin/account');
};

export const saveCourseAiSettings = async (req, res) => {
  const provider = req.body.provider;
    if (!['gemini','groq','vertex'].includes(provider)) fail('Select Gemini, Groq, or Vertex AI.');
  const enabled = req.body.enabled === 'true';
  const gemini = req.body.geminiEnabled === 'true';
  const groq = req.body.groqEnabled === 'true';
    const vertex = req.body.vertexEnabled === 'true';
    const missingVertex = missingVertexSettings();
    if (enabled && provider === 'vertex' && vertex && missingVertex.length) fail(`Configure these Render variables for Vertex AI: ${missingVertex.join(', ')}.`);
    const vertexConfigured = missingVertex.length === 0;
    if (enabled && !(provider === 'groq' ? groq && process.env.GROQ_API_KEY?.trim() : provider === 'vertex' ? vertex && vertexConfigured : gemini && (process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_FALLBACK_API_KEY?.trim()))) fail('Enable the selected provider and configure its credentials in Render first.');
    const values = {courseAiProvider:provider,courseAiEnabled:String(enabled),courseGeminiEnabled:String(gemini),courseGroqEnabled:String(groq),courseVertexEnabled:String(vertex)};
  await sequelize.transaction(async transaction => {
    for (const [key,value] of Object.entries(values)) await Setting.upsert({key,value},{transaction});
    await audit(req.user.id,'course-ai.settings.updated','system','course-ai',values,transaction);
  });
  req.flash('success_msg','Course AI settings saved. New AI requests use the selected enabled provider.');
  res.redirect('/admin/settings');
};

