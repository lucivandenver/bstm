import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User, Course, CourseAttempt, StudentProfile, Credential, Assessment, Notification, sequelize } from '../models/learningModels.js';
import { Section, AuditLog, Setting, Announcement, CareerPath } from '../models/adminModels.js';
import { audit, ownerEmail, genders } from '../services/accounts.js';
import { text, email } from '../services/validation.js';
import { domains } from '../data/starterCourses.js';
const plain = row => row?.get({ plain: true });
const publicUser = row => { const { password, googleId, ...user } = plain(row); return { ...user, googleConnected: Boolean(googleId), owner: user.email === ownerEmail() }; };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const render = (res, view, data = {}) => res.render(`admin/${view}`, { adminNav: view, ...data });
const date = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
export const dashboard = async (req, res) => {
  const [students, faculty, pending, courses, enrollments, completed, credentials, recent] = await Promise.all([
    User.count({ where: { role: 'student' } }), User.count({ where: { role: 'faculty' } }), User.count({ where: { role: 'faculty', approvalStatus: 'pending' } }),
    Course.count(), CourseAttempt.count(), CourseAttempt.count({ where: { status: 'completed' } }), Credential.count({ where: { revoked: false } }),
    AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 8 })
  ]);
  render(res, 'dashboard', { title: 'Administration', students, faculty, pending, courses, enrollments, completed, credentials, completionRate: enrollments ? Math.round(completed / enrollments * 100) : 0, recent: recent.map(r => ({ ...plain(r), date: date(r.createdAt) })) });
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
  render(res, 'users', { title: 'Users & faculty approval', users: rows.map(publicUser), q, role: req.query.role, approval: req.query.approval, count, page,
    next: page * 30 < count ? `/admin/users?${query}&page=${page + 1}` : null, previous: page > 1 ? `/admin/users?${query}&page=${page - 1}` : null });
};
export const userDetail = async (req, res) => {
  const user = await User.findByPk(req.params.id); if (!user) return res.status(404).send('User not found.');
  const [profile, attempts, sections] = await Promise.all([StudentProfile.findOne({ where: { userId: user.id } }), CourseAttempt.findAll({ where: { userId: user.id }, order: [['createdAt', 'DESC']] }), Section.findAll({ order: [['name', 'ASC']] })]);
  render(res, 'user', { title: 'Account details', account: publicUser(user), profile: plain(profile), genders, sections: sections.map(plain),
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
      if ((user.role === 'admin' || data.role === 'admin') && req.user.email !== ownerEmail()) fail('Only the owner can manage administrator roles.');
      if ((user.id === req.user.id || user.email === ownerEmail()) && (!data.active || data.role !== 'admin')) fail('You cannot disable or demote yourself or the system owner.');
      if (data.section && !await Section.findOne({ where: { name: data.section }, transaction })) fail('Section not found.');
      if (user.role === 'admin' && (!data.active || data.role !== 'admin') && await User.count({ where: { role: 'admin', active: true }, transaction }) <= 1) fail('At least one active administrator is required.');
      await user.update(data, { transaction });
      await audit(req.user.id, 'user.updated', 'user', user.id, { role: data.role, active: data.active, approval: data.approvalStatus }, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That institutional ID is already assigned.'); throw error; }
  req.flash('success_msg', 'Account updated.'); res.redirect(`/admin/users/${req.params.id}`);
};
export const createUser = async (req, res) => {
  if (!['student', 'faculty'].includes(req.body.role)) fail('Create a Student or Faculty account. Administrator promotion is handled on account details.');
  const data = accountValues({ ...req.body, active: 'true' });
  const address = email(req.body.email); const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address === ownerEmail()) fail('Use a valid unreserved email.');
  if (typeof password !== 'string' || password.length < 14 || Buffer.byteLength(password) > 72) fail('Use an initial password of at least 14 characters, at most 72 bytes.');
  if (data.section && !await Section.findOne({ where: { name: data.section, active: true } })) fail('Select an active section.');
  try {
    await sequelize.transaction(async transaction => {
      const user = await User.create({ ...data, email: address, password: await bcrypt.hash(password, 12) }, { transaction });
      await audit(req.user.id, 'user.created', 'user', user.id, { role: data.role }, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('Email or institutional ID already exists.'); throw error; }
  req.flash('success_msg', 'Account created. Share the initial password through your approved private channel.'); res.redirect('/admin/users');
};
export const approveFaculty = async (req, res) => {
  const status = text(req.body.status); if (!['approved', 'rejected'].includes(status)) fail('Invalid approval decision.');
  await sequelize.transaction(async transaction => {
    const user = await User.findOne({ where: { id: req.params.id, role: 'faculty' }, transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('Faculty account not found.');
    await user.update({ approvalStatus: status }, { transaction });
    await Notification.create({ userId: user.id, title: 'Faculty account review', message: `Your faculty registration was ${status}.`, href: '/faculty' }, { transaction });
    await audit(req.user.id, `faculty.${status}`, 'user', user.id, {}, transaction);
  });
  req.flash('success_msg', `Faculty account ${status}.`); res.redirect('/admin/users?role=faculty');
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
export const sections = async (req, res) => render(res, 'sections', { title: 'Sections & faculty assignments', sections: (await Section.findAll({ include: [{ model: User, as: 'faculty', attributes: ['id', 'name'] }], order: [['name', 'ASC']] })).map(plain), faculty: (await User.findAll({ where: { role: 'faculty', active: true, approvalStatus: 'approved' }, attributes: ['id', 'name'] })).map(plain) });
export const saveSection = async (req, res) => {
  const name = text(req.body.name, 60), academicYear = text(req.body.academicYear, 30), facultyId = Number(req.body.facultyId) || null;
  if (!name || !/^\d{4}-\d{4}$/.test(academicYear)) fail('Enter section name and academic year (2026-2027).');
  if (facultyId && !await User.findOne({ where: { id: facultyId, role: 'faculty', active: true, approvalStatus: 'approved' } })) fail('Select an approved faculty member.');
  try {
    await sequelize.transaction(async transaction => {
      let section = req.params.id ? await Section.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (req.params.id && !section) fail('Section not found.');
      const data = { name, academicYear, facultyId, active: req.body.active === 'true' };
      if (section) { const oldName = section.name; await section.update(data, { transaction }); if (oldName !== name) await User.update({ section: name }, { where: { role: 'student', section: oldName }, transaction }); }
      else section = await Section.create(data, { transaction });
      await audit(req.user.id, 'section.saved', 'section', section.id, {}, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That section already exists.'); throw error; }
  req.flash('success_msg', 'Section saved.'); res.redirect('/admin/sections');
};
export const courses = async (req, res) => render(res, 'courses', { title: 'Course oversight', courses: (await Course.findAll({ order: [['title', 'ASC']] })).map(c => ({ ...plain(c), moduleCount: c.modules.length })), domains });
export const saveCourse = async (req, res) => {
  const title = text(req.body.title, 160), domain = text(req.body.domain, 60), score = Number(req.body.passingScore);
  if (!title || !domains.includes(domain) || !Number.isInteger(score) || score < 50 || score > 100) fail('Check course title, area and passing score (50–100).');
  await sequelize.transaction(async transaction => {
    const course = await Course.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!course) fail('Course not found.');
    await course.update({ title, description: text(req.body.description, 2000), domain, passingScore: score, published: req.body.published === 'true', version: course.version + 1 }, { transaction });
    await audit(req.user.id, 'course.updated', 'course', course.id, { version: course.version, published: course.published }, transaction);
  });
  req.flash('success_msg', 'Course updated. Existing learning attempts retain their original requirements.'); res.redirect('/admin/courses');
};
export const credentials = async (req, res) => {
  const rows = await Credential.findAll({ order: [['issuedAt', 'DESC']], limit: 200 });
  render(res, 'credentials', { title: 'Certificates & badges', credentials: rows.map(c => ({ ...plain(c), date: date(c.issuedAt) })) });
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
      const data = { title, focus: text(req.body.focus, 160), required, active: req.body.active === 'true' };
      let row = req.params.id ? await CareerPath.findByPk(req.params.id, { transaction }) : null;
      if (req.params.id && !row) fail('Career path not found.');
      if (row) await row.update(data, { transaction }); else row = await CareerPath.create(data, { transaction });
      await audit(req.user.id, 'career.saved', 'career', row.id, {}, transaction);
    });
  } catch (error) { if (error.name === 'SequelizeUniqueConstraintError') fail('That pathway title already exists.'); throw error; }
  req.flash('success_msg', 'Career pathway saved.'); res.redirect('/admin/careers');
};
export const settings = async (req, res) => render(res, 'settings', { title: 'System settings', portalSettings: Object.fromEntries((await Setting.findAll()).map(s => [s.key, s.value])), googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
export const saveSettings = async (req, res) => {
  const values = { institutionName: text(req.body.institutionName, 160), academicYear: text(req.body.academicYear, 30), certificateFooter: text(req.body.certificateFooter, 250), registrationEnabled: req.body.registrationEnabled === 'true' ? 'true' : 'false', facultyRegistrationEnabled: req.body.facultyRegistrationEnabled === 'true' ? 'true' : 'false' };
  if (!values.institutionName || !/^\d{4}-\d{4}$/.test(values.academicYear)) fail('Enter an institution and academic year.');
  await sequelize.transaction(async transaction => {
    for (const [key, value] of Object.entries(values)) await Setting.upsert({ key, value }, { transaction });
    await audit(req.user.id, 'settings.updated', 'system', 'settings', {}, transaction);
  });
  req.flash('success_msg', 'Settings saved.'); res.redirect('/admin/settings');
};
export const auditLogs = async (req, res) => render(res, 'audit', { title: 'Activity & audit logs', logs: (await AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 200 })).map(l => ({ ...plain(l), date: date(l.createdAt), detail: JSON.stringify(l.details) })) });
export const reports = async (req, res) => {
  const attempts = await CourseAttempt.findAll({ include: [{ model: User, attributes: ['id', 'name', 'section'] }], order: [['createdAt', 'DESC']], limit: 500 });
  const diagnostics = await Assessment.findAll({ order: [['createdAt', 'DESC']], limit: 500 });
  render(res, 'reports', { title: 'Learning & readiness reports', attempts: attempts.map(a => ({ ...plain(a), title: a.snapshot.title, date: date(a.createdAt) })), diagnostics: diagnostics.map(d => ({ ...plain(d), date: date(d.createdAt) })) });
};
export const exportReport = async (req, res) => {
  const rows = await CourseAttempt.findAll({ include: [{ model: User, attributes: ['name', 'section'] }], order: [['createdAt', 'DESC']] });
  const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const data = [['Student', 'Section', 'Course', 'Attempt', 'Status', 'Final score', 'Active minutes', 'Started'], ...rows.map(a => [a.User?.name, a.User?.section, a.snapshot.title, a.attemptNumber, a.status, a.finalScore, Math.floor(a.activeSeconds / 60), a.createdAt.toISOString()])];
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="CareerBridge-learning-report.csv"' });
  res.send('\uFEFF' + data.map(r => r.map(cell).join(',')).join('\r\n'));
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
