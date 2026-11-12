import { Op } from 'sequelize';
import { User, Course, CourseAttempt, Assessment, Credential, sequelize, Notification } from '../models/learningModels.js';
import { ProfileCorrection, CourseRevision, AiJob, SourceDocument, PracticalSubmission, CredentialRequest } from '../models/portalModels.js';
import { Section, Setting } from '../models/adminModels.js';
import { audit, setting } from '../services/accounts.js';
import { fail } from '../services/courseAuthoring.js';
import { text } from '../services/validation.js';
import { domains } from '../data/starterCourses.js';
import { courseAiConfiguration } from '../services/courseAiProvider.js';
const plain = r => r.get({ plain: true });
const render = (res, view, data) => res.render(`admin/${view}`, { adminNav: view, backUrl: view === 'history' ? '/admin/courses' : '/admin/settings', ...data });
export const academic = async (req, res) => {
  const corrections = await ProfileCorrection.findAll({ include: [{ model: User, attributes: ['id', 'name', 'studentId', 'section'] }], order: [['createdAt', 'DESC']], limit: 100 });
  render(res, 'academic', { title: 'Academic record corrections', corrections: corrections.map(r => ({ ...plain(r), pending: r.status === 'pending' })) });
};
export const correct = async (req, res) => {
  if (!['approved','rejected'].includes(req.body.status)) fail('Invalid decision.');
  try { await sequelize.transaction(async transaction => {
    const row = await ProfileCorrection.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE }); if (!row || row.status !== 'pending') fail('Pending correction not found.');
    if (req.body.status === 'approved') { if (!await Section.findOne({ where: { name: row.section, active: true }, transaction })) fail('Requested section is no longer active.'); const user = await User.findOne({ where: { id: row.userId, role: 'student' }, transaction, lock: transaction.LOCK.UPDATE }); if (!user) fail('Student account not found.'); await user.update({ studentId: row.studentId, section: row.section }, { transaction }); }
    await row.update({ status: req.body.status, reviewedBy: req.user.id }, { transaction });
    await Notification.create({ userId: row.userId, title: 'Academic correction reviewed', message: `Your academic record correction was ${req.body.status}.`, href: '/student/profile' }, { transaction });
    await audit(req.user.id, 'academic.correction_' + req.body.status, 'user', row.userId, {}, transaction);
  }); } catch (e) { if (e.name === 'SequelizeUniqueConstraintError') fail('Requested Student ID is already assigned.'); throw e; }
  req.flash('success_msg', 'Correction reviewed.'); res.redirect('/admin/academic');
};
export const ownership = async (req, res) => {
  const course = await Course.findByPk(req.params.id); if (!course) fail('Course not found.',404);
  const owner = Number(req.body.ownerId); if (!await User.findOne({ where: { id: owner, role: 'faculty', approvalStatus: 'approved', active: true } })) fail('Select an active approved faculty member.');
  await sequelize.transaction(async transaction => { await course.update({ ownerId: owner, awardsApproved: false }, { transaction }); await CredentialRequest.update({ status: 'returned', remarks: 'Course ownership changed. The new faculty owner must submit credentials for review.' }, { where: { courseId: course.id, status: 'approved' }, transaction }); const attempts = await CourseAttempt.findAll({ where: { courseId: course.id }, transaction }); for (const attempt of attempts) await attempt.update({ snapshot: { ...attempt.snapshot, awardsApproved: false } }, { transaction }); await audit(req.user.id, 'course.owner_assigned', 'course', course.id, { ownerId: owner }, transaction); }); req.flash('success_msg','Course ownership assigned. Credential approval must be requested by the new faculty owner.'); res.redirect('/admin/courses');
};
export const history = async (req, res) => { const course = await Course.findByPk(req.params.id); if (!course) fail('Course not found.',404); render(res,'history',{ title: 'Course publication history', course: plain(course), revisions: (await CourseRevision.findAll({ where: { courseId: course.id }, order: [['createdAt','DESC']], limit: 100 })).map(r => ({...plain(r), date: new Date(r.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})})) }); };
export const ai = async (req, res) => { const config=await courseAiConfiguration(); render(res,'ai',{ title: 'AI operations', configured: config.ready, enabled: config.enabled, provider: config.provider, providerLabel: config.label, model: config.model, jobs: (await AiJob.findAll({ order: [['createdAt','DESC']], limit: 100 })).map(j => ({...plain(j), date: new Date(j.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})})), sources: await SourceDocument.count() }); };
export const competencies = async (req, res) => { let descriptions = {}; try { descriptions = JSON.parse(await setting('competencyDescriptions','{}')); } catch {} render(res,'competencies',{ title: 'Competency framework', domains: domains.map((name,i) => ({ name, index: i, description: descriptions[name] || '' })) }); };
export const saveCompetencies = async (req, res) => { const descriptions = Object.fromEntries(domains.map((name,i) => [name,text(req.body[`domain${i}`],1000)])); await Setting.upsert({ key: 'competencyDescriptions', value: JSON.stringify(descriptions) }); await audit(req.user.id,'competencies.updated','system','domains'); res.redirect('/admin/competencies'); };
export const maintenance = async (req,res) => render(res,'maintenance',{ title:'Maintenance & deployment', databaseReady: true, students: await User.count({where:{role:'student'}}), courses: await Course.count(), attempts: await CourseAttempt.count(), credentials: await Credential.count(), pending: await PracticalSubmission.count({where:{status:'submitted'}}) });
