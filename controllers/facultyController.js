import { moduleEvidence } from '../services/moduleEvidence.js';
import { sendWorkbook } from '../services/reportWorkbook.js';
import { duplicateModule, duplicateModuleMessage } from '../services/moduleDuplicates.js';
import { facultySignature, preparePublicationCredential } from '../services/publicationCredentials.js';
import { randomUUID as newModuleId } from 'node:crypto';
import { createHash } from 'node:crypto';
import { sourceLimits } from '../services/sourceLimits.js';
import { startCourseJob, startBlueprintJob, courseJobStatus } from '../services/courseJobs.js';
import { validatedSignature } from '../services/signatureProcessing.js';
import { summarizeLearning } from '../services/evidence.js';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User, Course, CourseAttempt, Credential, SavedCourse, Assessment, Notification, sequelize } from '../models/learningModels.js';
import { Section, Announcement, Setting, CareerPath } from '../models/adminModels.js';
import { CourseRevision, CourseAssignment, QuestionBank, SourceDocument, SourceFilePart, AiJob, PracticalSubmission, QuizDraft, CourseFeedback, FacultyNote, CredentialRequest } from '../models/portalModels.js';
import { text } from '../services/validation.js';
import { audit } from '../services/accounts.js';
import { domains } from '../data/starterCourses.js';
import { courseAreas, courseInput, publishCheck, questionInput, fail } from '../services/courseAuthoring.js';
import { generateCourse, aiConfiguration, sourceSections } from '../services/courseAi.js';
import { generationError, safeGenerationError } from '../services/courseGenerationErrors.js';
import { extractSource } from '../services/sourceExtraction.js';
import { progress, publicQuestions } from '../services/learning.js';
import { finalizeAttempt, syncPublishedAttempt } from '../services/portalLearning.js';
function savedArray(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value : [];
}
const plain = r => r?.get({ plain: true });
const date = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
const progressPages = new Set(['announcements', 'monitoring', 'reports', 'assignments', 'evaluations']);
const render = (res, view, data = {}) => res.render(`faculty/${view}`, {
  facultyNav: progressPages.has(view) ? 'students' : view,
  backUrl: progressPages.has(view) ? '/faculty/students' : ['dashboard', 'student'].includes(view) ? null : '/faculty',
  ...data
});
export const assignedSections = req => Section.findAll({ where: { active: true }, order: [['name','ASC']] });
export async function assignedStudents(req) { const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), ids = courses.map(c => c.id); const [attempts, assignments, legacySections] = await Promise.all([CourseAttempt.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['userId'], group: ['userId'] }), CourseAssignment.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['sectionId'] }), Section.findAll({ where: { facultyId: req.user.id, active: true }, attributes: ['id', 'name'] })]); const sections = [...new Map([...legacySections, ...(assignments.length ? await Section.findAll({ where: { id: { [Op.in]: assignments.map(a => a.sectionId) } }, attributes: ['id', 'name'] }) : [])].map(section => [section.id, section])).values()]; const scopes = [{ id: { [Op.in]: attempts.map(a => a.userId) } }]; if (sections.length) scopes.push({ section: { [Op.in]: sections.map(s => s.name) } }); return User.findAll({ where: { role: 'student', [Op.or]: scopes }, attributes: ['id', 'name', 'studentId', 'section', 'email', 'gender'] }); }
async function studentAccess(req) { const students = await assignedStudents(req); const s = students.find(s => s.id === Number(req.params.id)); if (!s) fail('Assigned student not found.', 404); return s; }
async function ownedCourse(req, transaction) { const c = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) }); if (!c) fail('Course not found or not owned by your account.', 404); return c; }
export const dashboard = async (req, res) => {
  const sections = await assignedSections(req), students = await assignedStudents(req), owned = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: owned.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
  const pending = await PracticalSubmission.count({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, status: 'submitted' } });
  const completed = attempts.filter(a => a.status === 'completed').length;
  render(res, 'dashboard', { title: 'Faculty overview', students: students.slice(0, 8).map(plain), sections: sections.map(plain), studentCount: students.length, courseCount: await Course.count({ where: { ownerId: req.user.id } }), publishedCount: await Course.count({ where: { ownerId: req.user.id, published: true } }), pendingCredentials: await CredentialRequest.count({ where: { facultyId: req.user.id, status: 'pending' } }), active: new Set(attempts.filter(a => a.status !== 'completed').map(a => a.userId)).size, pending, completed, completionRate: attempts.length ? Math.round(completed / attempts.length * 100) : 0, support: students.filter(s => attempts.some(a => a.userId === s.id && a.status !== 'completed' && (!a.lastActivityAt || Date.now() - new Date(a.lastActivityAt) > 7 * 86400000))).map(plain) });
};
export const profile = async (req, res) => render(res, 'profile', { title: 'My faculty profile', savedSignature: await facultySignature(req.user.id), googleConnected: Boolean(req.user.googleId), returned: req.user.approvalStatus === 'returned' });
export const saveProfile = async (req, res) => { const name = text(req.body.name, 100), facultyPosition = text(req.body.facultyPosition, 120), facultyEducation = text(req.body.facultyEducation, 200), facultyQualifications = text(req.body.facultyQualifications, 2000); if (name.length < 2 || !facultyPosition || !facultyEducation || !facultyQualifications) fail('Complete your name, position, education and qualifications.'); const resubmit = req.user.approvalStatus === 'returned'; await req.user.update({ name, facultyPosition, facultyEducation, facultyQualifications, ...(resubmit ? { approvalStatus: 'pending', facultyReviewedBy: null, facultyReviewedAt: null } : {}) }); if (resubmit) { const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] }); await Notification.bulkCreate(admins.map(admin => ({ userId: admin.id, title: 'Faculty registration resubmitted', message: `${name} updated a returned registration for review.`, href: '/admin/faculty?approval=pending' }))); } req.flash('success_msg', resubmit ? 'Profile updated and returned registration resubmitted for Admin review.' : 'Faculty profile saved.'); res.redirect('/faculty/profile'); };
export const saveFacultySignature = async (req, res) => {
  try {
    const signature = await validatedSignature(req.body.signature);
    await Setting.upsert({ key: `facultySignature:${req.user.id}`, value: signature });
    req.flash('success_msg', 'Faculty signature saved.');
  } catch (error) {
    if (error.status !== 422) throw error;
    req.flash('error_msg', error.message);
  }
  res.redirect('/faculty/profile#faculty-signature');
};
export const credentials = async (req, res) => {
  const courses = await Course.findAll({ where: { ownerId: req.user.id, certificateEnabled: true }, attributes: ['id','title','domain','published','certificateEnabled','awardsApproved','modules'], order: [['title', 'ASC']] });
  const requests = await CredentialRequest.findAll({ where: { facultyId: req.user.id }, order: [['updatedAt', 'DESC']] });
  const settings = Object.fromEntries((await Setting.findAll({ where: { key: ['institutionName'] } })).map(s => [s.key, s.value]));
  const savedSignature = await facultySignature(req.user.id);
  render(res, 'credentials', { title: 'Certificates & badges', facultyName:req.user.name, facultyPosition:req.user.facultyPosition, savedSignature, ...settings, courses: courses.map(c => ({ ...plain(c), modules: savedArray(c.modules), signature: savedSignature || requests.find(r => r.courseId === c.id)?.facultySignature, request: plain(requests.find(r => r.courseId === c.id)) })) });
};
export const submitCredential = async (req, res) => {
  const label=text(req.body.badgeLabel,60)||'Course completion';
  const saved = await sequelize.transaction(async transaction=>{
    const course=await ownedCourse(req,transaction);if(!course.certificateEnabled)fail('Enable certificates before requesting approval.');
    const key = `facultySignature:${req.user.id}`;
    const signature = await validatedSignature(req.body.signature || (await Setting.findOne({ where: { key }, transaction }))?.value);
    await Setting.upsert({ key, value: signature }, { transaction });
    if (req.body.saveReusable === 'yes') return;
    const [request,created]=await CredentialRequest.findOrCreate({where:{courseId:course.id},defaults:{facultyId:req.user.id,facultySignature:signature,badge:{enabled:true,label},status:'pending'},transaction});
    if(!created)await request.update({facultyId:req.user.id,facultySignature:signature,badge:{enabled:true,label},status:'pending',remarks:null,reviewedBy:null,reviewedAt:null},{transaction});
    await course.update({awardsApproved:false},{transaction});
    const attempts=await CourseAttempt.findAll({where:{courseId:course.id},transaction});
    for(const attempt of attempts)await attempt.update({snapshot:{...attempt.snapshot,awardsApproved:false}},{transaction});
    await audit(req.user.id,'credential.requested','course',course.id,{requestId:request.id},transaction);
  }).catch(error => {
    if (req.body.saveReusable !== 'yes' || error.status !== 422) throw error;
    req.flash('error_msg', error.message);
    return false;
  });
  if (saved === false) return res.redirect('/faculty/credentials');
  req.flash('success_msg',req.body.saveReusable === 'yes' ? 'Faculty signature saved for current and future publications.' : 'Transparent signature and credential configuration sent to Admin for review. Existing issued awards retain their original signatures.');res.redirect('/faculty/credentials');
};
export const deleteCredentialRequest = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    if (!course.published || !course.certificateEnabled) fail('Only a published course with certificates enabled can have an award configuration.');
    const request = await CredentialRequest.findOne({ where: { courseId: course.id, facultyId: req.user.id }, transaction });
    if (!request) fail('No certificate configuration was found for this course.', 404);
    await request.destroy({ transaction });
    await course.update({ awardsApproved: false }, { transaction });
    const attempts = await CourseAttempt.findAll({ where: { courseId: course.id }, transaction });
    for (const attempt of attempts) await attempt.update({ snapshot: { ...attempt.snapshot, awardsApproved: false } }, { transaction });
    await audit(req.user.id, 'credential.configuration_removed', 'course', course.id, { requestId: request.id }, transaction);
  });
  req.flash('success_msg', 'Certificate signature configuration removed. Existing student certificates remain in their records. Turn off certificate issuance in course settings to stop future certificates.');
  res.redirect('/faculty/credentials');
};
const publicationHistory = ['archived', 'admin-archived', 'published', 'admin-published'];
const pendingPublication = (course, revision) => revision?.action === 'pending-review' && revision.version === course.version;
const returnedPublication = revision => ['publication-declined', 'publication-cancelled'].includes(revision?.action);
const archivedCourse = (course, revision, previouslyPublished) =>
  !course.published && !pendingPublication(course, revision) && !returnedPublication(revision) && previouslyPublished;
export const courses = async (req, res) => {
  let courses, databaseNotice='';
  try { courses = await Course.findAll({ where: { ownerId: req.user.id }, order: [['id', 'DESC']] }); }
  catch(error) { console.error('[Faculty course list]',JSON.stringify({resource:'courses',name:error.name,code:error.original?.code||error.parent?.code||null})); courses=[]; databaseNotice='The course list could not read course records. Ask Admin to check the database migration and connection, then refresh.'; }
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 160) : '';
  const archived = req.query.list === 'archive';
  const drafts = req.query.list === 'drafts' || (!archived && req.query.status === 'draft');
  const list = archived ? 'archive' : drafts ? 'drafts' : 'active';
  const status = !archived && ['pending', 'approved', 'draft'].includes(req.query.status) ? req.query.status : '';
  const revisions = courses.length ? await CourseRevision.findAll({
    where: { courseId: { [Op.in]: courses.map(course => course.id) }, action: { [Op.in]: ['archived', 'admin-archived', 'published', 'admin-published', 'pending-review', 'draft', 'publication-declined', 'publication-cancelled'] } },
    attributes: ['id', 'courseId', 'action', 'version'],
    order: [['id', 'DESC']]
  }) : [];
  const latest = new Map();
  for (const revision of revisions) {
    if (!latest.has(revision.courseId)) latest.set(revision.courseId, revision);
  }
  const previouslyPublished = new Set(revisions.filter(revision => publicationHistory.includes(revision.action)).map(revision => revision.courseId));
  const unpublishedIds = courses.filter(course => !course.published && !previouslyPublished.has(course.id) && !pendingPublication(course, latest.get(course.id))).map(course => course.id);
  if (unpublishedIds.length) {
    const historicalAttempts = await CourseAttempt.findAll({ where: { courseId: unpublishedIds }, attributes: ['courseId'], group: ['courseId'] });
    for (const attempt of historicalAttempts) previouslyPublished.add(attempt.courseId);
  }
  const courseById = new Map(courses.map(course => [course.id, course]));
  const moduleRevisions = courses.length ? await CourseRevision.findAll({
    where: { courseId: [...courseById.keys()], ...(!archived ? { actorId: req.user.id } : {}), action: archived ? 'module-archived' : drafts ? 'module-draft' : 'module-pending' },
    order: [['id', 'DESC']]
  }) : [];
  const modulesByCourse = new Map();
  for (const row of moduleRevisions) {
    const module = row.snapshot?.module;
    if (!module) continue;
    const items = modulesByCourse.get(row.courseId) || [];
    items.push({ ...module, number: module.number ?? savedArray(courseById.get(row.courseId).modules).length + 1, status: archived ? 'Archived' : drafts ? 'Draft' : 'Pending Admin review', revisionId: row.id, declineReason: drafts ? row.snapshot.declineReason : null, editUrl: `/faculty/courses/${row.courseId}/edit?revision=${row.id}#module-revision-${row.id}` });
    modulesByCourse.set(row.courseId, items);
  }
  const listedModules = course => {
    const revision = latest.get(course.id);
    const isArchived = archivedCourse(course, revision, previouslyPublished.has(course.id));
    const stored = (archived && !isArchived) || (drafts && (course.published || pendingPublication(course, revision) || isArchived))
      ? [] : savedArray(course.modules);
    const status = course.published ? 'Published' : archived ? 'Archived' : pendingPublication(course, revision) ? 'Pending Admin review' : 'Draft';
    const revisions = modulesByCourse.get(course.id) || [];
    return [
      ...stored.map((module, index) => ({ ...module, number: module.number ?? index + 1, status, editUrl: `/faculty/courses/${course.id}/edit?module=${encodeURIComponent(module.id)}#edit-module-${module.id}` })).filter(module => !revisions.some(row => row.id === module.id)),
      ...revisions
    ];
  };
  const matches = courses.filter(course => {
    if ((drafts || archived) && !listedModules(course).length) return false;
    const revision = latest.get(course.id);
    const isArchived = archivedCourse(course, revision, previouslyPublished.has(course.id));
    const courseStatus = course.published ? 'approved' : pendingPublication(course, revision) ? 'pending' : 'draft';
    return ((isArchived === archived && (archived || drafts === (courseStatus === 'draft'))) || ((drafts || archived || !course.published) && modulesByCourse.has(course.id))) && (!status || (status === 'pending' ? courseStatus === 'pending' || modulesByCourse.has(course.id) : status === courseStatus)) && [course.title, ...listedModules(course).map(module => module.title)]
      .some(title => String(title || '').toLowerCase().includes(query.toLowerCase()));
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / 4));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const listUrl = (number, tab = list) => '/faculty/courses?' + new URLSearchParams({
    q: query, list: tab, status: tab === list ? status : '', page: String(number)
  });
  courses = matches.slice((page - 1) * 4, page * 4);
  const selectedId = Number(req.query.course);
  const selectedCourse = selectedId ? matches.find(course => course.id === selectedId) : null;
  if (selectedId && !selectedCourse) fail('Course not found in this list.', 404);
  const cards = courses.map(course => ({
    ...plain(course), title: course.title.toUpperCase(), moduleCount: listedModules(course).length,
    hasPending: list === 'active' && listedModules(course).some(module => module.status === 'Pending Admin review'),
    href: listUrl(page) + '&course=' + course.id
  }));
  let detail;
  if (selectedCourse) {
    const c = selectedCourse;
    const draftOnly = drafts && (c.published || pendingPublication(c, latest.get(c.id)) || archivedCourse(c, latest.get(c.id), previouslyPublished.has(c.id)));
    const hasHistory = !c.published && !draftOnly && (
      await CourseAttempt.count({ where: { courseId: c.id } }) ||
      await CredentialRequest.count({ where: { courseId: c.id } }) ||
      await CourseAssignment.count({ where: { courseId: c.id } })
    );
    const latestRevision = latest.get(c.id);
    const declineReason = latestRevision?.action === 'publication-declined'
      ? (await CourseRevision.findByPk(latestRevision.id))?.snapshot?.declineReason : null;
    detail = { ...plain(c), declineReason, modules: listedModules(c).map(module => ({
      ...module, actionUrl: `/faculty/courses/${c.id}/module/${encodeURIComponent(module.id)}`,
      pending: module.status === 'Pending Admin review',
      canDelete: Boolean(module.revisionId) || !hasHistory
    })), draftOnly,
      pendingReview: pendingPublication(c, latest.get(c.id)),
      deleteEligible: drafts && !draftOnly && !hasHistory };
  }
  render(res, selectedCourse ? 'course-modules' : 'courses', {
    facultyNav: 'courses', title: selectedCourse?.title || (archived ? 'Archived courses' : drafts ? 'Draft courses' : 'My courses'),
    databaseNotice, query, status, archived, drafts, list, page, pageCount, courses: cards, course: detail,
    moduleListStatus: archived ? 'Archive' : drafts ? 'Draft' : selectedCourse?.published ? 'Published' : 'Pending Admin review',
    backUrl: selectedCourse ? listUrl(page) : null,
    activeUrl: listUrl(1, 'active'), draftsUrl: listUrl(1, 'drafts'), archiveUrl: listUrl(1, 'archive'),
    previousUrl: page > 1 ? listUrl(page - 1) : null, nextUrl: page < pageCount ? listUrl(page + 1) : null
  });
};
export const editor = async (req, res) => {
  const course = plain(await ownedCourse(req));
  for(const field of ['modules','questions','tasks','outcomes','prerequisites','policy','competencyAreas']){
    if(typeof course[field]==='string')try{course[field]=JSON.parse(course[field]);}catch{fail('This course contains unreadable saved content. Open its original source to generate a replacement.',422);}
  }
  course.competencyAreas=courseAreas(course.competencyAreas,course.domain);
  const [bank, otherCourses, revisions] = await Promise.all([QuestionBank.findAll({ where: { ownerId: req.user.id, active: true, reviewed: true }, limit: 200 }), Course.findAll({ where: { published: true }, attributes: ['id', 'title'] }), course.id ? CourseRevision.findAll({ where: { courseId: course.id }, attributes:['version','action','createdAt'], order: [['createdAt', 'DESC']], limit: 20 }) : []]);
  const generatedDraft = !course.published && await AiJob.count({ where: { courseId: course.id, type: 'course-draft', status: 'completed' } });
  const destinations = generatedDraft ? await Course.findAll({
    where: { ownerId: req.user.id, id: { [Op.ne]: course.id } },
    attributes: ['id', 'title'], order: [['title', 'ASC']]
  }) : [];
  const signatureMissing = !await facultySignature(req.user.id);
  const moduleSubmissions = await CourseRevision.findAll({
    where: { courseId: course.id, actorId: req.user.id, action: ['module-draft', 'module-pending'], ...(req.query.revision ? { id: Number(req.query.revision) } : {}) }, order: [['id', 'DESC']]
  });
  if (req.query.revision && !moduleSubmissions.length) fail('Module draft not found.', 404);
  const storedModule = course.modules.find(module => module.id === req.query.module);
  const moduleState = req.query.revision
    ? (moduleSubmissions[0].action === 'module-pending' ? 'Pending Admin review' : 'Draft')
    : storedModule ? (course.published ? 'Published' : 'Draft') : null;
  const revision = req.query.revision ? moduleSubmissions[0] : null;
  const scopedDraft = revision?.action === 'module-draft';
  const editorCourse = scopedDraft ? { ...course, modules: [revision.snapshot.module], questions: revision.snapshot.questions } : course;
  render(res, 'editor', { editorCourse, generation: revision?.snapshot.generation, scopedDraft, editorEnabled: scopedDraft || !revision, revisionId: revision?.id, title: req.query.revision ? moduleSubmissions[0].snapshot.module.title : 'Revise course',
    moduleOnly: Boolean(req.query.revision), moduleState, signatureMissing, moduleSubmissions: scopedDraft ? [] : moduleSubmissions.map(row => ({ ...plain(row), pending: row.action === 'module-pending' })), destinations: destinations.map(plain), backUrl: req.query.revision ? `/faculty/courses?list=${moduleSubmissions[0].action === 'module-pending' ? 'active' : 'drafts'}&course=${course.id}` : '/faculty/courses', course, domains, bank: bank.map(plain), otherCourses: otherCourses.map(plain), revisions: revisions.map(r => ({ ...plain(r), date: date(r.createdAt) })) });
};
async function storeSourceFile(source, document, transaction) {
  const where = { sourceId: source.id, documentKey: document.key, part: 0 };
  if (await SourceFilePart.count({ where, transaction })) return;
  const partSize = 256 * 1024;
  for (let offset = 0; offset < document.buffer.length; offset += partSize) {
    await SourceFilePart.create({
      ...where, ownerId: source.ownerId, part: offset / partSize, filename: document.name,
      bytes: document.buffer.length, content: document.buffer.subarray(offset, offset + partSize)
    }, { transaction });
  }
}

export const attachOriginalFile = async (req, res) => {
  const file = req.file;
  if (!file || !/\.pdf$/i.test(file.originalname) || !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    fail('Choose a valid PDF file.', 422);
  }
  const name = text(file.originalname.slice(0, -4), 116) + '.pdf';
  const key = createHash('sha256').update(file.buffer).digest('hex');
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    const modules = savedArray(course.modules);
    const module = modules.find(item => item.id === req.body.moduleId);
    if (!module) fail('Select a module in this course.', 422);
    if (module.materials?.some(material => material.documentKey === key)) return;

    const source = await SourceDocument.create({ ownerId: req.user.id, filename: name, sections: [] }, { transaction });
    await storeSourceFile(source, { name, key, buffer: file.buffer }, transaction);
    const material = { sourceId: source.id, documentKey: key };
    const attach = items => items.map(item => item.id === module.id
      ? { ...item, materials: [...(item.materials || []), material] }
      : item);
    await course.update({ modules: attach(modules) }, { transaction });

    const attempts = await CourseAttempt.findAll({
      where: { courseId: course.id, status: 'ongoing' }, transaction, lock: transaction.LOCK.UPDATE
    });
    for (const attempt of attempts) {
      if (attempt.snapshot.ownerId !== course.ownerId || !attempt.snapshot.modules?.some(item => item.id === module.id)) continue;
      const quizScores = { ...attempt.quizScores };
      if (!(quizScores[module.id] >= attempt.snapshot.passingScore)) delete quizScores[`read:${module.id}`];
      await attempt.update({ snapshot: { ...attempt.snapshot, modules: attach(attempt.snapshot.modules) }, quizScores }, { transaction });
    }
    await audit(req.user.id, 'module.material_attached', 'course', course.id, { moduleId: module.id, sourceId: source.id }, transaction);
  });
  req.flash('success_msg', 'Original PDF attached to the existing module.');
  res.json({ redirect: `/faculty/courses/${req.params.id}/edit#original-material` });
};

export const attachGeneratedModule = async (req, res) => {
  const destinationId = Number(req.body.destinationId);
  if (!Number.isSafeInteger(destinationId) || destinationId < 1 || destinationId === Number(req.params.id)) fail('Select another course you own.');
  await sequelize.transaction(async transaction => {
    const rows = await Course.findAll({
      where: { id: [Number(req.params.id), destinationId], ownerId: req.user.id },
      order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE
    });
    const source = rows.find(row => row.id === Number(req.params.id));
    const destination = rows.find(row => row.id === destinationId);
    if (!source || !destination) fail('Course not found.', 404);
    if (source.published) fail('Select an unpublished generated draft.');
    if (!await AiJob.count({ where: { courseId: source.id, userId: req.user.id, type: 'course-draft', status: 'completed' }, transaction })) fail('Select a draft created through Upload & Generate.');
    const combine = req.body.moduleId === 'all';
    const selected = savedArray(source.modules).filter(item => combine || item.id === req.body.moduleId);
    if (!selected.length) fail('Select generated content.');
    const modules = savedArray(destination.modules).map((item, index) => ({ ...item, number: item.number ?? index + 1 }));
    const number = destination.published || combine || !req.body.moduleNumber
      ? Math.max(0, ...modules.map(item => item.number)) + 1
      : Number(req.body.moduleNumber);
    const title = text(req.body.moduleTitle, 160) || (combine ? '' : selected[0].title);
    if (title.length < 4) fail('Enter a module name of at least four characters.');
    const id = newModuleId();
    const lessonIds = new Map();
    const lessons = selected.flatMap(module => module.lessons.map(lesson => {
      const lessonId = newModuleId();
      lessonIds.set(`${module.id}:${lesson.id}`, lessonId);
      return { ...lesson, id: lessonId, sourceReviewed: false };
    }));
    const selectedIds = new Set(selected.map(module => module.id));
    const questions = savedArray(source.questions).filter(question => selectedIds.has(question.moduleId)).map(question => ({
      ...question, id: newModuleId(), moduleId: id,
      lessonId: lessonIds.get(`${question.moduleId}:${question.lessonId}`), reviewed: false
    }));
    const materials = [...new Map(selected.flatMap(module => module.materials || []).map(item => [`${item.sourceId}:${item.documentKey}`, item])).values()];
    const skills = [...new Set(selected.flatMap(module => module.skills || []))].slice(0, 12);
    const duplicate = destination.published && duplicateModule(modules, { title, materials, lessons });
    if (duplicate) fail(duplicateModuleMessage(duplicate), 409);
    const data = courseInput({
      ...plain(destination),
      modules: [...modules, { id, title, number, lessons, materials, skills }],
      questions: [...savedArray(destination.questions), ...questions]
    }, { draft: true });
    const separateModuleDrafts = !modules.length && await CourseRevision.count({
      where: { courseId: destination.id, action: ['last-module-archived', 'module-pending', 'module-draft'] }, transaction
    });
    if (destination.published || separateModuleDrafts) {
      const prior = await CourseRevision.findAll({
        where: { courseId: destination.id, actorId: req.user.id, action: ['module-draft', 'module-pending', 'module-published'] }, transaction
      });
      const sourceKey = `${source.id}:${source.version}:${req.body.moduleId}`;
      if (prior.some(row => row.snapshot?.sourceKey === sourceKey)) return;
      await CourseRevision.create({
        courseId: destination.id, actorId: req.user.id, version: destination.version, action: 'module-draft',
        snapshot: { sourceKey, module: data.modules.at(-1), questions: data.questions.filter(question => question.moduleId === id) }
      }, { transaction });
      await audit(req.user.id, 'course.module_attached', 'course', destination.id, { sourceCourseId: source.id, moduleId: id }, transaction);
      return;
    }
    await CourseRevision.create({ courseId: destination.id, actorId: req.user.id, version: destination.version, action: 'before-edit', snapshot: plain(destination) }, { transaction });
    await destination.update({ modules: data.modules, questions: data.questions, awardsApproved: false, version: destination.version + 1 }, { transaction });
    await CredentialRequest.update({ status: 'returned', remarks: 'Course modules changed. Resubmit the certificate configuration.' }, { where: { courseId: destination.id, status: 'approved' }, transaction });
    await audit(req.user.id, 'course.module_attached', 'course', destination.id, { sourceCourseId: source.id, moduleId: id }, transaction);
  });
  req.flash('success_msg', 'Module attached. Review the updated course and submit it for Admin approval.');
  res.redirect(`/faculty/courses/${destinationId}/edit#module-submissions`);
};
export const saveCourse = async (req, res) => {
  const approve=req.body.action==='approve-generated',publish=approve||req.body.action==='publish';
  let input,id,missingSignature;
  if(!approve){try{input=JSON.parse(req.body.courseData);}catch{fail('Invalid course form. Reload and try again.');}}
  if (!approve && publish && req.body.confirmReview === 'yes') {
    input.modules = (input.modules || []).map(module => ({ ...module, lessons: (module.lessons || []).map(lesson => ({ ...lesson, sourceReviewed: true })) }));
    input.questions = (input.questions || []).map(question => ({ ...question, reviewed: true }));
  }
  await sequelize.transaction(async transaction => {
    const c=await ownedCourse(req,transaction);
    if(approve){
      if(req.body.confirmReview!=='yes'||Number(req.body.version)!==c.version)fail('Review the current course version before publishing.',409);
      if(c.published)fail('This course is already published.',409);
      if(!await AiJob.count({where:{courseId:c.id,status:'completed',type:'course-draft'},transaction}))fail('Generate a course from your saved materials first.');
      input={...plain(c),modules:c.modules.map(module=>({...module,lessons:module.lessons.map(lesson=>({...lesson,sourceReviewed:true}))})),questions:c.questions.map(q=>({...q,reviewed:true}))};
    }
    const data=courseInput({ ...input, title: text(input.title, 160).toUpperCase() },{draft:!publish});
    if (c.published) for (const module of data.modules) {
      const current = savedArray(c.modules);
      const duplicate = duplicateModule(current, module, module.id, current.find(item => item.id === module.id));
      if (duplicate) fail(duplicateModuleMessage(duplicate), 409);
    }
    if (c && data.prerequisites.includes(c.id)) fail('A course cannot require itself.');
    // Every prerequisite must exist and cannot create an indirect cycle.
    for (const prerequisite of data.prerequisites) {
      const seen = new Set(); const visit = async cid => { if (c && cid === c.id) fail('Prerequisites would form a cycle.'); if (seen.has(cid)) return; seen.add(cid); const dependency = await Course.findByPk(cid, { transaction }); if (!dependency) fail('Prerequisite course does not exist.'); for (const next of dependency.prerequisites) await visit(Number(next)); }; await visit(prerequisite);
    }
    if (publish) {
      publishCheck(data);
      const generatedJobs = await AiJob.findAll({ where: { courseId: c.id, status: 'completed', type: 'course-draft' }, attributes: ['sourceId'], transaction });
      if (generatedJobs.length) {
        const sources = await SourceDocument.findAll({ where: { id: generatedJobs.map(job => job.sourceId).filter(Boolean), ownerId: req.user.id }, transaction });
        const sourceRows = sources.flatMap(sourceSections);
        const norm = value => String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();
        for (const module of data.modules) for (const lesson of module.lessons) {
          const evidence = sourceRows.filter(row => row.reference === lesson.sourceReference);
          if (!lesson.sourceReviewed) fail('Review every generated lesson in the editor or confirm the complete review in student preview before publishing.', 422);
          if (!lesson.sourceQuote || !evidence.some(row => norm(row.text).includes(norm(lesson.sourceQuote)))) {
            lesson.sourceQuote = '';
            lesson.sourceNeedsReview = true;
            if (!evidence.length) lesson.sourceReference = 'Manual faculty review · no direct citation';
          }
        }
        for (const question of data.questions) {
          const evidence = sourceRows.filter(row => row.reference === question.sourceReference);
          if (!question.sourceQuote || !evidence.some(row => norm(row.text).includes(norm(question.sourceQuote)))) {
            question.sourceQuote = '';
            question.sourceNeedsReview = true;
            if (!evidence.length) question.sourceReference = 'Manual faculty review · no direct citation';
          }
        }
      }
    }
    { await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'before-edit', snapshot: plain(c) }, { transaction }); await c.update({ ...data, starter: false, awardsApproved: false, version: c.version + 1, published: false }, { transaction }); await CredentialRequest.update({ status: 'returned', remarks: 'Course content changed. The certificate will be reviewed with the next publication submission.' }, { where: { courseId: c.id, status: 'approved' }, transaction }); const attempts = await CourseAttempt.findAll({ where: { courseId: c.id }, transaction }); for (const attempt of attempts) await attempt.update({ snapshot: { ...attempt.snapshot, awardsApproved: false } }, { transaction }); }
    id = c.id;
    if (publish) {
      missingSignature = c.certificateEnabled && !await preparePublicationCredential(c, transaction);
      const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'], transaction });
      if (admins.length) await Notification.bulkCreate(admins.map(admin => ({
        userId: admin.id, title: 'Course ready for review', message: `${c.title} · Version ${c.version}`, href: `/admin/courses#course-${c.id}`
      })), { transaction });
    }
    const prior = await CourseRevision.findOne({
      where: { courseId: c.id, action: { [Op.in]: ['archived', 'admin-archived', 'published', 'admin-published'] } },
      order: [['id', 'DESC']], transaction
    });
    const remainsArchived = !publish && ['archived', 'admin-archived'].includes(prior?.action);
    await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: publish ? 'pending-review' : remainsArchived ? 'archived' : 'draft', snapshot: plain(c) }, { transaction });
    await audit(req.user.id, publish ? 'course.submitted_for_review' : 'course.draft_saved', 'course', c.id, { version: c.version }, transaction);
  });
  req.flash('success_msg', publish ? missingSignature ? 'Course submitted. Save your faculty signature under My Profile before Admin can publish.' : 'Course and certificate submitted together for Admin approval.' : 'Draft saved. Publishing requires complete assessments and one course-wide review confirmation.'); res.redirect(`/faculty/courses/${id}/edit`);
};
export const saveModuleTopics = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    const revision = await CourseRevision.findOne({
      where: { id: req.params.revisionId, courseId: course.id, actorId: req.user.id, action: 'module-draft' }, transaction
    });
    if (!revision) fail('This module draft is no longer editable.', 409);
    const { module } = revision.snapshot;
    if (req.body.courseData) {
      let input;
      try { input = JSON.parse(req.body.courseData); } catch { fail('Invalid module form.'); }
      if (!Array.isArray(input?.modules) || input.modules.length !== 1 || input.modules[0].id !== module.id ||
          !Array.isArray(input.questions)) fail('Keep the selected module in this draft.');
      const reviewed = req.body.action === 'publish' && req.body.confirmReview === 'yes';
      const data = courseInput({
        ...plain(course), modules: [{ ...input.modules[0], materials: module.materials,
          lessons: input.modules[0].lessons.map(lesson => ({ ...lesson, sourceReviewed: reviewed })) }],
        questions: input.questions.map(question => ({ ...question, reviewed }))
      }, { draft: !reviewed });
      await revision.update({ snapshot: { ...revision.snapshot, module: data.modules[0], questions: data.questions } }, { transaction });
      if (req.body.action === 'publish') {
        if (!reviewed) fail('Confirm that you reviewed the module.');
        publishCheck(data);
        await queueModulePublication(req, course, revision, transaction);
      }
      return;
    }

    const title = text(req.body.moduleTitle, 160);
    const titles = [].concat(req.body.topicTitle || []).map(value => text(value, 160));
    const bodies = [].concat(req.body.topicBody || []).map(value => text(value, 16000));
    if (title.length < 4 || titles.length !== module.lessons.length || titles.some(value => !value) ||
      bodies.length !== module.lessons.length || bodies.some(value => value.length < 30)) {
      fail('Enter a module title, a name and at least 30 characters of content for every topic area.', 422);
    }
    const lessons = module.lessons.map((lesson, index) => ({
      ...lesson, title: titles[index], body: bodies[index], sourceReviewed: false
    }));
    const questions = revision.snapshot.questions.map(question => {
      const edited = req.body.quiz?.[question.id];
      if (!edited) return question;
      return questionInput({
        ...question, prompt: edited.prompt, explanation: edited.explanation,
        options: text(edited.options, 3100).split(/\r?\n/).map(option => option.trim()).filter(Boolean),
        answer: Number(edited.answer), reviewed: false
      }, course.domain);
    });
    await revision.update({ snapshot: { ...revision.snapshot, questions, module: { ...module, title, lessons } } }, { transaction });
  });
  req.flash('success_msg', req.body.action === 'publish' ? 'Module submitted for Admin review.' : 'Module draft saved.');
  res.redirect(`/faculty/courses/${req.params.id}/edit?revision=${req.params.revisionId}#module-revision-${req.params.revisionId}`);
};
async function queueModulePublication(req, course, draft, transaction) {
  const current = savedArray(course.modules);
  const candidate = draft.snapshot.module;
  const pending = await CourseRevision.findAll({
    where: { courseId: course.id, actorId: req.user.id, action: 'module-pending' }, transaction
  });
  if (pending.some(row => row.snapshot?.module?.id === candidate.id)) {
    fail('This module already has a revision awaiting Admin review.', 409);
  }
  const duplicate = course.published && duplicateModule(current, candidate, candidate.id, current.find(item => item.id === candidate.id));
  if (duplicate) fail(duplicateModuleMessage(duplicate), 409);
  if (!course.published && current.length) {
    if (!draft.snapshot.fromCourseDraft || !current.some(module => module.id === candidate.id)) {
      fail('Review the course draft before submitting this module.', 409);
    }
    const otherDrafts = await CourseRevision.findAll({
      where: { courseId: course.id, actorId: req.user.id, action: 'module-draft' }, transaction
    });
    const questions = savedArray(course.questions);
    for (const [index, module] of current.entries()) {
      if (otherDrafts.some(row => row.snapshot?.module?.id === module.id)) continue;
      await CourseRevision.create({
        courseId: course.id, actorId: req.user.id, version: course.version, action: 'module-draft',
        snapshot: { module: { ...module, number: module.number ?? index + 1 },
          questions: questions.filter(question => question.moduleId === module.id) }
      }, { transaction });
    }
    await course.update({ modules: [], questions: [], version: course.version + 1 }, { transaction });
  }
  await draft.update({ action: 'module-pending' }, { transaction });
  const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'], transaction });
  if (admins.length) await Notification.bulkCreate(admins.map(admin => ({
    userId: admin.id, title: 'Module ready for review', message: draft.snapshot.module.title, href: '/admin/courses?status=pending'
  })), { transaction });
}
export const submitModulePublication = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    const draft = await CourseRevision.findOne({
      where: { id: req.params.revisionId, courseId: course.id, actorId: req.user.id, action: 'module-draft' }, transaction
    });
    if (!draft || req.body.confirmReview !== 'yes') fail('Review the module before submitting it.');
    await queueModulePublication(req, course, draft, transaction);
  });
  req.flash('success_msg', 'Module and certificate submitted for Admin review.');
  res.redirect(`/faculty/courses/${req.params.id}/edit?revision=${req.params.revisionId}#module-revision-${req.params.revisionId}`);
};

export const manageModule = async (req, res) => {
  let redirect;
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    const { moduleId, action } = req.params;
    const modules = savedArray(course.modules);
    const questions = savedArray(course.questions);
    const module = modules.find(item => item.id === moduleId);
    const revisions = await CourseRevision.findAll({
      where: { courseId: course.id, action: ['module-draft', 'module-pending', 'module-archived'] },
      order: [['id', 'DESC']], transaction
    });
    const matching = revisions.filter(row => row.snapshot?.module?.id === moduleId &&
      (row.action === 'module-archived' || row.actorId === req.user.id));
    const revision = matching.find(row => String(row.id) === req.body.revisionId);
    if (req.body.revisionId && !revision) fail('Module revision not found.', 404);
    const list = ['delete-draft', 'cancel-submission'].includes(action) ? 'drafts' : 'archive';
    redirect = `/faculty/courses?list=${list}`;
    if (action === 'unpublish') redirect += `&course=${course.id}`;
    const snapshot = item => ({ module: { ...item, number: item.number ?? modules.indexOf(item) + 1 },
      questions: questions.filter(question => question.moduleId === item.id) });
    const create = (item, type, extra = {}) => CourseRevision.create({
      courseId: course.id, actorId: req.user.id, version: course.version, action: type, snapshot: { ...snapshot(item), ...extra }
    }, { transaction });
    const remove = ids => {
      const remaining = modules.filter(item => !ids.includes(item.id));
      return course.update({
        modules: remaining, questions: questions.filter(question => !ids.includes(question.moduleId)),
        version: course.version + 1, published: course.published && remaining.length > 0
      }, { transaction });
    };
    if (action === 'cancel-submission') {
      if (revision?.action === 'module-pending') {
        await revision.update({ action: 'module-draft' }, { transaction });
      } else if (!req.body.revisionId && !course.published && module) {
        const submission = await CourseRevision.findOne({
          where: { courseId: course.id, action: [...publicationHistory, 'pending-review', 'draft', 'publication-declined', 'publication-cancelled'] },
          order: [['id', 'DESC']], transaction
        });
        if (!pendingPublication(course, submission) || submission.actorId !== req.user.id) fail('This publication is no longer pending.', 409);
        await submission.update({ action: 'publication-cancelled' }, { transaction });
      } else fail('This publication is no longer pending.', 409);
      redirect += `&course=${course.id}`;
    } else if (action === 'edit' && course.published && module) {
      if (matching.some(row => row.action === 'module-pending')) fail('This module already has a revision awaiting Admin review.', 409);
      const draft = matching.find(row => row.action === 'module-draft') || await create(module, 'module-draft');
      redirect = `/faculty/courses/${course.id}/edit?revision=${draft.id}#module-revision-${draft.id}`;
    } else if (action === 'unpublish' && course.published && module) {
      if (matching.some(row => row.action === 'module-pending')) fail('This module already has a revision awaiting Admin review.', 409);
      await create(module, 'module-archived');
      if (modules.length === 1) await CourseRevision.create({
        courseId: course.id, actorId: req.user.id, version: course.version, action: 'last-module-archived', snapshot: {}
      }, { transaction });
      await remove([moduleId]);
    } else if (action === 'delete-draft' && revision?.action === 'module-draft') {
      if (revision.snapshot.fromCourseDraft && module && !course.published) await remove([moduleId]);
      await revision.update({ action: 'module-deleted', snapshot: {} }, { transaction });
    } else if (action === 'delete-module' && revision?.action === 'module-archived') {
      await revision.update({ action: 'module-deleted', snapshot: {} }, { transaction });
    } else if (!revision && !course.published && module) {
      const latest = await CourseRevision.findOne({
        where: { courseId: course.id, action: ['archived', 'admin-archived', 'published', 'admin-published', 'pending-review', 'draft', 'publication-declined', 'publication-cancelled'] },
        order: [['id', 'DESC']], transaction
      });
      const archived = !returnedPublication(latest) && (publicationHistory.includes(latest?.action) ||
        await CourseAttempt.count({ where: { courseId: course.id }, transaction }) > 0);
      if (pendingPublication(course, latest)) fail('This course is awaiting Admin review.', 409);
      if (action === 'review' && !archived) {
        const draft = matching.find(row => row.action === 'module-draft') || await create(module, 'module-draft', { fromCourseDraft: true });
        redirect = `/faculty/courses/${course.id}/edit?revision=${draft.id}#module-revision-${draft.id}`;
      } else if ((action === 'delete-draft' && !archived) || (action === 'delete-module' && archived)) {
        await remove([moduleId]);
      } else fail('This module action is unavailable.', 409);
    } else fail('This module action is unavailable.', 409);
    await audit(req.user.id, `module.${action}`, 'course', course.id, { moduleId }, transaction);
  });
  if (!['edit', 'review'].includes(req.params.action)) req.flash('success_msg', {
    unpublish: 'Module moved to Archive.', 'delete-draft': 'Module draft deleted.',
    'delete-module': 'Archived module deleted.', 'cancel-submission': 'Submission cancelled. Open the draft to edit or resubmit it.'
  }[req.params.action]);
  res.redirect(redirect);
};

export const archiveCourse = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    if (!course.published) return;
    await course.update({ published: false }, { transaction });
    await CourseRevision.create({
      courseId: course.id, actorId: req.user.id, version: course.version, action: 'archived', snapshot: { ...plain(course), archivedForRepublication: true }
    }, { transaction });
    await audit(req.user.id, 'course.archived', 'course', course.id, undefined, transaction);
  });
  req.flash('success_msg', 'Course archived. Existing attempts remain accessible.');
  res.redirect('/faculty/courses?list=archive');
};
export const deleteDraft = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    if (course.published) fail('Unpublish this course before deleting it.');
    const submission = await CourseRevision.findOne({ where: { courseId: course.id, version: course.version, action: 'pending-review' }, transaction });
    if (submission) fail('A course pending Admin review cannot be deleted here.');
    const [attempts, requests, assignments] = await Promise.all([
      CourseAttempt.count({ where: { courseId: course.id }, transaction }),
      CredentialRequest.count({ where: { courseId: course.id }, transaction }),
      CourseAssignment.count({ where: { courseId: course.id }, transaction })
    ]);
    if (attempts || requests || assignments) fail('This draft has associated learner or credential records. Keep it as an archived draft to preserve history.');
    await CourseRevision.destroy({ where: { courseId: course.id }, transaction });
    await audit(req.user.id, 'course.draft_deleted', 'course', course.id, { title: course.title }, transaction);
    await course.destroy({ transaction });
  });
  req.flash('success_msg', 'Unused draft deleted.'); res.redirect('/faculty/courses');
};
export const deleteArchivedCourse = async (req, res) => {
  if (req.body.confirmDelete !== 'yes') fail('Confirm permanent deletion first.');
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    const history = await CourseRevision.findAll({
      where: { courseId: course.id, action: [...publicationHistory, 'pending-review', 'draft', 'publication-declined', 'publication-cancelled'] },
      attributes: ['action', 'version'], order: [['id', 'DESC']], transaction
    });
    const attempts = await CourseAttempt.findAll({
      where: { courseId: course.id }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE
    });
    if (!archivedCourse(course, history[0], attempts.length > 0 || history.some(revision => publicationHistory.includes(revision.action)))) fail('Only archived courses can be permanently deleted.');
    const attemptIds = attempts.map(attempt => attempt.id);
    if (attemptIds.length) {
      const where = { attemptId: attemptIds };
      for (const model of [Credential, QuizDraft, PracticalSubmission, CourseFeedback]) await model.destroy({ where, transaction });
      await CourseAttempt.destroy({ where: { id: attemptIds }, transaction });
    }
    const where = { courseId: course.id };
    for (const model of [SavedCourse, CourseAssignment, CredentialRequest, CourseRevision, AiJob]) await model.destroy({ where, transaction });
    await course.destroy({ transaction });
    await audit(req.user.id, 'course.archive_deleted', 'course', course.id, { title: course.title, attemptsRemoved: attempts.length }, transaction);
  });
  req.flash('success_msg', 'Archived course and its learner records permanently deleted.');
  res.redirect('/faculty/courses?list=archive');
};
export const preview = async (req, res) => {
  const record = await ownedCourse(req);
  const course = plain(record);
  const moduleId = req.params.moduleId;
  let state;
  if (moduleId) {
    const module = savedArray(record.modules).find(item => item.id === moduleId);
    if (!module) fail('Module not found.', 404);
    course.modules = [module];
    course.questions = savedArray(record.questions).filter(question => question.moduleId === moduleId);
    course.tasks = [];
    state = record.published ? 'Published' : 'Draft';
  }
  render(res, 'preview', {
    title: moduleId ? course.modules[0].title : 'Student preview', moduleState: state,
    backUrl: moduleId ? `/faculty/courses?course=${course.id}&list=${record.published ? 'active' : 'drafts'}` : `/faculty/courses/${course.id}/edit`,
    course, generated: !moduleId && Boolean(await AiJob.count({ where: { courseId: course.id, status: 'completed', type: 'course-draft' } })),
    questions: publicQuestions(course.questions)
  });
};
const sourceValues = body => ({ destinationId: Number(body?.destinationId), moduleTitle: text(body?.moduleTitle, 160), topicCount: Number(body?.topicCount) || 5, topicTitles: text(body?.topicTitles, 4000), areas:[].concat(body?.competencyAreas||body?.domain||[]), domain: domains.includes(body?.domain) ? body.domain : '', outcomes: text(body?.outcomes, 1500), level: ['Foundation','Intermediate','Advanced'].includes(body?.level) ? body.level : 'Foundation', questionCount: Math.max(3, Math.min(30, Number(body?.questionCount) || 8)), consent: body?.consent === 'yes' });
function sourceSettings(input) {
  const { areas, consent, topicTitles, ...values } = sourceValues(input);
  return { ...values, destinationId: values.destinationId || null,
    competencyAreas: areas.filter(area => domains.includes(area)) };
}
const sourceDiagnostics = source => {
  const grouped = new Map();
  for (const section of sourceSections(source)) {
    const key = section.documentKey || section.documentName || source.filename;
    const item = grouped.get(key) || { name: section.documentName || source.filename, sections: 0, characters: 0, references: [] };
    item.sections++; item.characters += section.text.length; item.references.push(section.reference); grouped.set(key, item);
  }
  return [...grouped.values()].map(item => ({ ...item, units: new Set(item.references.map(ref => ref.match(/(?:Page|Slide|Paragraph)\s+\d+/i)?.[0]).filter(Boolean)).size, warning: item.characters < 600 ? 'Low extracted text; check for scanned or mostly empty pages.' : '' }));
};
const courseNameKey = title => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
async function generationDestinations(ownerId, selectedId, transaction) {
  const courses = await Course.findAll({
    where: { ownerId }, attributes: ['id', 'title', 'published'],
    order: [['published', 'DESC'], ['id', 'ASC']], transaction
  });
  const unique = new Map();
  for (const course of courses) {
    const name = courseNameKey(course.title);
    if (!unique.has(name) || course.id === Number(selectedId)) unique.set(name, plain(course));
  }
  return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title));
}
const sourceView = async (res, source, body, error) => render(res, 'source', { destinations: await generationDestinations(source.ownerId, body?.destinationId), title: 'Review source material', backUrl: '/faculty/upload', source: { ...plain(source), sections: sourceSections(source) }, sourceDiagnostics: sourceDiagnostics(source), domains, aiReady: (await aiConfiguration()).ready, aiProviderLabel: (await aiConfiguration()).label, values: sourceValues(body), error });
export const createCourse = async (req, res) => {
  const title = text(req.body.title, 160).toUpperCase();
  if (title.length < 4) fail('Enter a course name of at least four characters.');
  const course = await sequelize.transaction(async transaction => {
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
    const existing = (await generationDestinations(req.user.id, null, transaction))
      .find(item => courseNameKey(item.title) === courseNameKey(title));
    return existing || Course.create({ title, ownerId: req.user.id, slug: `course-${newModuleId()}`, published: false }, { transaction });
  });
  res.redirect(`/faculty/upload?courseId=${course.id}`);
};
export const uploadPage = async (req, res) => {
  const destinations = await generationDestinations(req.user.id, req.query.courseId);
  const jobWhere = { userId: req.user.id, type: 'course-draft' };
  const historyPages = Math.max(1, Math.ceil(await AiJob.count({ where: jobWhere }) / 10));
  const historyPage = Math.min(historyPages, Math.max(1, Number.parseInt(req.query.historyPage, 10) || 1));
  const historyUrl = page => '/faculty/upload?' + new URLSearchParams({ historyPage: page, ...(req.query.courseId ? { courseId: req.query.courseId } : {}) }) + '#generation-history';
  return render(res, 'upload', { title: 'Upload & generate', historyPage, historyPages, previousHistory: historyPage > 1 ? historyUrl(historyPage - 1) : null, nextHistory: historyPage < historyPages ? historyUrl(historyPage + 1) : null, destinations, selectedCourseId: Number(req.query.courseId), domains, aiReady: (await aiConfiguration()).ready, aiProviderLabel: (await aiConfiguration()).label, sources: (await SourceDocument.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']], attributes: ['id', 'filename'], limit: 20 })).map(plain), jobs: (await AiJob.findAll({ where: jobWhere, attributes:['id','createdAt','status','errorCode','courseId'], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 10, offset: (historyPage - 1) * 10 })).map(j => ({ ...plain(j), date: date(j.createdAt) })) });
};
export const upload = async (req, res) => {
  const json=req.get('accept')?.includes('application/json');
  const progressStream=req.get('accept')?.includes('application/x-ndjson');
  const emit=event=>{if(!progressStream)return;if(!res.headersSent){res.status(200).type('application/x-ndjson');res.set('Cache-Control','no-cache, no-transform');res.set('X-Accel-Buffering','no');res.flushHeaders?.();}res.write(`${JSON.stringify(event)}\n`);res.flush?.();};
  const reject=(message,status=422)=>{if(progressStream){if(!res.headersSent)res.status(status).type('application/x-ndjson').set('Cache-Control','no-cache, no-transform');res.write(`${JSON.stringify({ok:false,message,done:true})}\n`);return res.end();}if(json)return res.status(status).json({ok:false,message});req.flash('error_msg',message);return res.redirect('/faculty/upload');};
  const files=req.files||(req.file?[req.file]:[]),sourceId=req.body.sourceId;
  let generationSettings;
  if (req.body.settings) {
    try { generationSettings = sourceSettings(JSON.parse(req.body.settings)); }
    catch { return reject('The saved module settings could not be read.'); }
  }
  if(!files.length)return reject('Choose at least one PDF, DOCX, PPTX or TXT file.');
  if(files.reduce((n,f)=>n+f.buffer.length,0)>sourceLimits.requestBytes)return reject('Upload at most 100 MB per request. The upload queue sends one file at a time.',413);
  if(sourceId && (!/^\d+$/.test(sourceId)||!await SourceDocument.findOne({where:{id:sourceId,ownerId:req.user.id}})))return reject('Source collection not found.',404);
  const extracted=[],failed=[];
  for(const file of files){
    try{
      const key=createHash('sha256').update(file.buffer).digest('hex');
      emit({phase:'extracting',filename:text(file.originalname,120),current:0,total:0,unit:'pages'});
      const sections=await extractSource(file,{onProgress:progress=>emit({...progress,filename:text(file.originalname,120)})});
      extracted.push({buffer:file.buffer,name:text(file.originalname,120),key,sections:sections.map(section=>({...section,documentKey:key,documentName:text(file.originalname,120),reference:`${text(file.originalname,80)} [${key.slice(0,8)}] · ${section.reference}`}))});
    }catch(error){failed.push({filename:text(file.originalname,120),message:error.status?error.message:'Could not decode this document. Use a valid PDF, DOCX, PPTX or TXT file.'});}
  }
  if(!extracted.length)return reject(failed.map(f=>`${f.filename}: ${f.message}`).join(' · '));
  let source; const duplicateFiles=[];
  try{
    source=await sequelize.transaction(async transaction=>{
      const row=sourceId?await SourceDocument.findOne({where:{id:sourceId,ownerId:req.user.id},transaction,lock:transaction.LOCK.UPDATE}):null;
      if(sourceId&&!row)fail('Source collection not found.',404);
      if(row&&await AiJob.findOne({where:{sourceId:row.id,status:'running'},transaction}))fail('Wait for the current generation to finish before adding files.');
      const sections=row?sourceSections(row):[],keys=new Set(sections.map(s=>s.documentKey).filter(Boolean));
      for(const doc of extracted)if(!keys.has(doc.key)){sections.push(...doc.sections);keys.add(doc.key);}else duplicateFiles.push(doc.name);
      if(sections.length>sourceLimits.sections||sections.reduce((n,s)=>n+s.text.length,0)>sourceLimits.textCharacters)fail('This collection would exceed 1,000,000 extracted characters or 10,000 sections. Previously extracted files are safe; put remaining material in another course.');
      const names=[...new Set(sections.map(s=>s.documentName).filter(Boolean))];
      const filename=names.length>1?`${names[0]} + ${names.length-1} related files`:names[0]||row?.filename;
      const data = { filename, sections, ...(generationSettings ? { generationSettings } : {}) };
      const saved = row ? await row.update(data, { transaction }) : await SourceDocument.create({ ...data, ownerId: req.user.id }, { transaction });
      for (const doc of extracted) await storeSourceFile(saved, doc, transaction);
      await audit(req.user.id,'source.uploaded','source',saved.id,{files:extracted.length,failedFiles:failed.length,sections:sections.length},transaction);return saved;
    });
  }catch(error){if(error.status)return reject(error.message,error.status);const safe=safeGenerationError(error,'upload-save');return reject(`${safe.message} Reference: ${safe.reference}`,safe.status);}
  const redirect=`/faculty/sources/${source.id}`;
  if(progressStream){if(!res.headersSent)res.status(200).type('application/x-ndjson').set('Cache-Control','no-cache, no-transform');res.write(`${JSON.stringify({ok:true,done:true,sourceId:source.id,redirect,failed,duplicates:[...new Set(duplicateFiles)],files:extracted.map(f=>f.name)})}\n`);return res.end();}
  if(json)return res.json({ok:true,sourceId:source.id,redirect,failed,duplicates:[...new Set(duplicateFiles)],files:extracted.map(f=>f.name)});
  const notes=[...failed.map(f=>`${f.filename}: ${f.message}`),...(duplicateFiles.length?[`Duplicate files skipped: ${[...new Set(duplicateFiles)].join(', ')}.`]:[])];
  req.flash(notes.length?'error_msg':'success_msg',notes.length?notes.join(' · '):'Source collection saved. Review its extraction quality, then generate a module for the selected course.');res.redirect(redirect);
};
export const resumeGeneration = async (req,res) => {
  const invalid=(message,status=400)=>res.status(status).json({ok:false,message});
  try{
    const previous=await AiJob.findOne({where:{id:req.params.id,userId:req.user.id,type:'course-draft'}});
    if(!previous)return invalid('Generation request not found.',404);
    if(previous.status==='completed'&&previous.courseId)return res.json({ok:true,redirect:`/faculty/generation/${previous.id}`});
    const config=await aiConfiguration(),providers=config.fallback?[config.provider,'groq']:[config.provider];
    if(!previous.state?.options?.consent||!providers.every(provider=>previous.state.options.consentProviders?.includes(provider)))return invalid('Provider configuration changed or permission is missing. Open the saved source and confirm the current providers before generating again.');
    const source=await SourceDocument.findOne({where:{id:previous.sourceId,ownerId:req.user.id}});if(!source)return invalid('Source collection not found.',404);
    if(previous.state.retryAt&&Date.parse(previous.state.retryAt)>Date.now())return res.status(429).json({ok:false,message:'The provider waiting period has not ended. Your saved sections remain available.',retryAt:previous.state.retryAt});
    const job=previous.state?.phase==='blueprint'
      ? await startBlueprintJob(req.user.id,source,{...previous.state.options,consent:'yes'})
      : await startCourseJob(req.user.id,source,{...previous.state.options,consent:'yes'});
    res.status(202).json({ok:true,redirect:`/faculty/generation/${job.id}`});
  }catch(error){const safe=safeGenerationError(error,'resume');res.status(safe.status).json({ok:false,message:safe.message,code:safe.code,reference:safe.reference});}
};
export const approveBlueprint = async (req, res) => {
  try {
    const previous = await AiJob.findOne({ where: { id: req.params.id, userId: req.user.id, type: 'course-draft' } });
    if (!previous || previous.status !== 'review' || previous.state?.phase !== 'blueprint') return res.status(409).json({ ok: false, message: 'This blueprint is no longer waiting for review.' });
    const source = await SourceDocument.findOne({ where: { id: previous.sourceId, ownerId: req.user.id } });
    if (!source) return res.status(404).json({ ok: false, message: 'Source collection not found.' });
    const original = previous.state.blueprint, sections = sourceSections(source);
    if (original.modules?.length > Number(previous.state.options?.questionCount)) return res.status(422).json({ ok: false, message: 'The blueprint has more modules than assessment questions. Reduce the module count or increase the question count before approval.' });
    const titles = [].concat(req.body.moduleTitle || []).map(v => text(v, 160)).filter(Boolean);
    const outcomesByModule = [].concat(req.body.moduleOutcomes || []);
    const refs = [].concat(req.body.moduleReference || []);
    if (titles.length < 1 || titles.length > 6 || refs.length !== titles.length) return res.status(422).json({ ok: false, message: 'Keep 1–6 modules and retain a valid source reference for each.' });
    const modules = titles.map((title, i) => {
      const reference = text(refs[i], 200), section = sections.find(s => s.reference === reference);
      if (!section) throw generationError('COURSE_SOURCE_UNSUPPORTED');
      return { title, outcomes: text(outcomesByModule[i], 1000).split(/\r?\n/).map(v => text(v, 300)).filter(Boolean).slice(0, 5), sourceReference: reference, sourceNeedsReview: !section.text.trim() || original.modules[i]?.sourceNeedsReview === true };
    });
    const areas = [].concat(req.body.competencyAreas || []).filter(a => domains.includes(a));
    if (!areas.length) return res.status(422).json({ ok: false, message: 'Select at least one competency area.' });
    const blueprint = { ...original, title: text(req.body.title, 160), description: text(req.body.description, 2000), outcomes: text(req.body.outcomes, 1500).split(/\r?\n/).map(v => text(v, 500)).filter(Boolean).slice(0, 12), competencyAreas: [...new Set(areas)], modules };
    if (blueprint.title.length < 4 || !blueprint.description || !blueprint.outcomes.length || modules.some(m => !m.outcomes.length)) return res.status(422).json({ ok: false, message: 'Complete the title, description, learning outcomes and outcomes for each module.' });
    const options = { ...previous.state.options, domain: areas[0], competencyAreas: [...new Set(areas)], outcomes: blueprint.outcomes.join('\n'), courseTitle: blueprint.title, blueprint, consent: 'yes' };
    await previous.update({ status: 'approved', state: { ...previous.state, blueprint } });
    const job = await startCourseJob(req.user.id, source, options);
    return res.status(202).json({ ok: true, redirect: `/faculty/generation/${job.id}` });
  } catch (error) {
    const safe = safeGenerationError(error, 'blueprint-approval');
    return res.status(safe.status || 422).json({ ok: false, message: safe.message, code: safe.code });
  }
};
export const generationStatus = async (req,res) => {
  const progress=await courseJobStatus(req.user.id,req.params.id);
  if(req.get('accept')?.includes('application/json'))return res.json({ok:true,...progress});
  if (req.query.review === '1' && progress.status === 'completed' && progress.redirect) return res.redirect(progress.redirect);
  render(res,'generation',{title:progress.moduleTitle ? 'Generating your module' : 'Generating your course',progress});
};
export const source = async (req, res) => {
  const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
  if (!source) fail('Source not found.', 404);
  const job = await AiJob.findOne({ where: {
    sourceId: source.id, userId: req.user.id, type: 'course-draft',
    ...(req.query.job ? { id: Number(req.query.job) } : {})
  }, order: [['id', 'DESC']] });
  const options = job?.state?.options;
  const saved = source.generationSettings;
  const values = req.query.job && options || saved || options;
  await sourceView(res, source, { ...values, consent: '' });
};
export const deleteSource = async (req, res) => { const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404); await audit(req.user.id, 'source.deleted', 'source', source.id, { filename: source.filename }); await source.destroy(); req.flash('success_msg', 'Source resource deleted. Existing courses and generated drafts are unchanged.'); res.redirect('/faculty/upload'); };
export const generate = async (req, res) => {
  const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404);
  try {
    await source.update({ generationSettings: sourceSettings(req.body) });
    if(req.body.mode==='manual')throw generationError('COURSE_INPUT','Select Generate course to create lessons and assessments from these materials.');
    const selected=courseAreas([].concat(req.body.competencyAreas||req.body.domain||[]),req.body.domain);
    req.body.domain=selected[0];req.body.competencyAreas=selected;
    const values=sourceValues(req.body);
    if (!domains.includes(req.body.domain)) throw generationError('COURSE_INPUT', 'Choose the competency area for this course.');
    if (req.body.consent !== 'yes') throw generationError('COURSE_INPUT', 'Enter target outcomes and confirm permission to share this source with the selected AI provider.');
    if(req.body.background==='yes' || req.body.destinationId || req.body.scope === 'module'){
      const options = { ...req.body, outcomes: values.outcomes || 'Derive learning outcomes from the supplied materials.' };
      const destinationId = Number(req.body.destinationId);
      if (req.body.scope === 'module' || req.body.destinationId || req.body.moduleTitle) {
        const destination = await Course.findOne({ where: { id: destinationId, ownerId: req.user.id } });
        const moduleTitle = text(req.body.moduleTitle, 160);
        if (!destination || text(destination.title, 160).length < 4 || moduleTitle.length < 4) throw generationError('COURSE_INPUT', 'Select a course you own and enter a module title.');
        if (destination.published) {
          const materials = await SourceFilePart.findAll({ where: { sourceId: source.id, part: 0 }, attributes: ['documentKey'] });
          const duplicate = duplicateModule(savedArray(destination.modules), { title: moduleTitle, materials });
          if (duplicate) throw generationError('COURSE_DUPLICATE_MODULE', duplicateModuleMessage(duplicate));
        }
        const topicCount = req.body.topicCount == null || req.body.topicCount === "" ? null : Number(req.body.topicCount);
        if (topicCount !== null && (!Number.isInteger(topicCount) || topicCount < 5 || topicCount > 30)) throw generationError('COURSE_INPUT', 'Choose a topic target from 5 to 30.');
        const topicTitles = values.topicTitles.split(/\r?\n/).map(title => text(title, 160)).filter(Boolean);
        if (topicCount !== null && topicTitles.length > topicCount) throw generationError('COURSE_INPUT', 'The preferred topic list exceeds the topic target.');
        options.topicCount = topicCount;
        options.topicTitles = [...new Set(topicTitles)];
        options.destinationId = destination.id;
        options.moduleTitle = moduleTitle;
        options.courseTitle = destination.title;
      }
      const job = options.destinationId
        ? await startCourseJob(req.user.id, source, options)
        : await startBlueprintJob(req.user.id, source, options);
      const statusUrl=`/faculty/generation/${job.id}`;
      if(req.get('accept')?.includes('application/json'))return res.status(202).json({ok:true,statusUrl,redirect:statusUrl});
      return res.redirect(statusUrl);
    }
    const { course } = await generateCourse(req.user.id, source, { ...req.body, outcomes: values.outcomes || 'Derive learning outcomes from the supplied materials.' });
    req.flash('success_msg', 'AI draft created. Check lesson accuracy and every source reference, then mark each question reviewed before publishing.');
    const redirect = `/faculty/courses/${course.id}/edit`;
    if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, redirect });
    res.redirect(redirect);
  } catch (e) {
    const error = e.reference ? e : safeGenerationError(e, 'input');
    if (req.get('accept')?.includes('application/json')) return res.status(error.status).json({ ok: false, message: error.message, code: error.code, reference: error.reference });
    res.status(error.status); await sourceView(res, source, req.body, { message: error.message, code: error.code, reference: error.reference });
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
  const paths = await CareerPath.findAll({ where: { active: true } });
  const evidence = moduleEvidence(attempts.map(plain), paths.length ? paths.map(plain) : undefined);
  render(res, 'student', { title: student.name, student: plain(student), evidence, careerSuggestions: evidence.tracks.slice(0, 3), attempts: attempts.map(a => ({ ...plain(a), title: a.snapshot.title, ...progress(a), date: date(a.createdAt), lastActivity: date(a.lastActivityAt), minutes: Math.floor(a.activeSeconds / 60), elapsedDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000) })), domains: evidence.competencies, assessments: assessments.map(a => ({ ...plain(a), date: date(a.createdAt) })), notes: (await FacultyNote.findAll({ where: { studentId: student.id, facultyId: req.user.id }, order: [['createdAt', 'DESC']] })).map(n => ({ ...plain(n), date: date(n.createdAt) })) });
};
export const note = async (req, res) => { const student = await studentAccess(req); const feedback = text(req.body.feedback, 3000), remediation = text(req.body.remediation, 1500); if (!feedback) fail('Enter feedback.'); await FacultyNote.create({ studentId: student.id, facultyId: req.user.id, feedback, remediation, visibility: req.body.visibility === 'student' ? 'student' : 'internal' }); if (req.body.visibility === 'student') await Notification.create({ userId: student.id, title: 'Faculty feedback', message: 'Your faculty added learning feedback and recommended next steps.', href: '/student/results' }); await audit(req.user.id, 'faculty.feedback_added', 'user', student.id); res.redirect(`/faculty/students/${student.id}`); };
export const monitoring = async (req, res) => {
  const students = await assignedStudents(req), names = new Map(students.map(s => [s.id, s]));
  const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const rows = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: courses.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
  const tasks = await PracticalSubmission.findAll({ where: { attemptId: { [Op.in]: rows.map(a => a.id) }, status: 'submitted' } });
  const attempts = rows.map(a => ({ ...plain(a), student: plain(names.get(a.userId)), title: a.snapshot.title, ...progress(a), awaiting: tasks.some(t => t.attemptId === a.id), inactive: a.status !== 'completed' && Date.now() - new Date(a.lastActivityAt || a.createdAt) > 7 * 86400000, retaking: a.attemptNumber > 1, minutes: Math.floor(a.activeSeconds / 60), elapsedDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000), lastActivity: date(a.lastActivityAt) }));
  if (['xlsx', 'csv'].includes(req.query.export)) return sendWorkbook(res, 'assigned-student-progress.xlsx', [{
    name: 'Student progress',
    headers: ['Student', 'Section', 'Course', 'Attempt', 'Status', 'Progress (%)', 'Final score (%)', 'Active minutes', 'Elapsed days', 'Last activity'],
    rows: attempts.map(a => [a.student.name, a.student.section, a.title, a.attemptNumber, a.status, a.percent, a.finalScore, a.minutes, a.elapsedDays, a.lastActivity])
  }]);
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
    const initial = await PracticalSubmission.findByPk(req.params.id, { transaction });
    if (!initial || !students.some(student => student.id === initial.userId)) fail('Submission not found.', 404);
    const initialAttempt = await CourseAttempt.findByPk(initial.attemptId, { transaction });
    if (!initialAttempt) fail('Submission not found.', 404);
    const course = await Course.findOne({
      where: { id: initialAttempt.courseId, ownerId: req.user.id }, transaction, lock: transaction.LOCK.UPDATE
    });
    if (!course) fail('Submission not found.', 404);
    const attempt = await CourseAttempt.findByPk(initial.attemptId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!attempt || attempt.status === 'completed') fail('Completed attempts are immutable. Contact Admin about a credential review.');
    const submission = await PracticalSubmission.findByPk(initial.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!submission) fail('Submission not found.', 404);
    if (course.published) await syncPublishedAttempt(attempt, course, transaction);
    const task = attempt.snapshot.tasks?.find(t => t.id === submission.taskId); if (!task) fail('Task not found.'); const scores = {};
    for (const r of task.rubric) { const n = Number(req.body.scores?.[r.id]); if (req.body.scores?.[r.id] === '' || !Number.isFinite(n) || n < 0 || n > r.max) fail(`Enter a score from 0 to ${r.max} for ${r.label}.`); scores[r.id] = n; }
    const feedback = text(req.body.feedback, 3000); if (!feedback) fail('Provide feedback with the grade.'); const grade = Math.round(Object.values(scores).reduce((a,b) => a+b, 0) / task.rubric.reduce((a,r) => a+r.max,0) * 100);
    await submission.update({ scores, grade, feedback, status: 'graded', gradedBy: req.user.id, gradedAt: new Date() }, { transaction });
    await attempt.update({ quizScores: { ...attempt.quizScores, [`task:${task.id}`]: grade } }, { transaction });
    const user = students.find(s => s.id === submission.userId); userId = user.id; if (course.published) await finalizeAttempt(attempt, user, transaction);
    await Notification.create({ userId, title: 'Practical task graded', message: `${task.title}: ${grade}%. Review your rubric feedback.`, href: `/student/learn/${attempt.id}/activities` }, { transaction });
    await audit(req.user.id, 'practical.graded', 'attempt', attempt.id, { taskId: task.id, grade }, transaction);
  }); req.flash('success_msg', 'Rubric grade and feedback saved. Completion eligibility was recalculated.'); res.redirect('/faculty/evaluations');
};
async function announcementRecipients(req) {
  const students = await assignedStudents(req);
  const active = await User.findAll({
    where: { id: students.map(student => student.id), active: true },
    attributes: ['id', 'name', 'studentId', 'section'], order: [['name', 'ASC']]
  });
  return active;
}
export const announcements = async (req, res) => {
  const students = await announcementRecipients(req);
  const history = await Announcement.findAll({ where: { authorId: req.user.id }, order: [['createdAt', 'DESC']] });
  render(res, 'announcements', { title: 'Faculty announcements', students: students.map(plain),
    sections: [...new Set(students.map(student => student.section).filter(Boolean))].sort(),
    announcements: history.map(item => ({ ...plain(item), date: date(item.createdAt) })) });
};
export const announce = async (req, res) => {
  const title = text(req.body.title, 160), body = text(req.body.body, 3000);
  if (!title || !body) fail('Enter announcement title and message.');
  const students = await announcementRecipients(req);
  const ids = [].concat(req.body.studentIds || []).map(Number);
  const section = text(req.body.section, 100);
  const recipients = req.body.audience === 'section' && section ? students.filter(student => student.section === section) :
    req.body.audience === 'students' ? students.filter(student => ids.includes(student.id)) : [];
  if (!recipients.length || (req.body.audience === 'students' && new Set(ids).size !== recipients.length)) {
    fail('Select an eligible section or specific assigned students.');
  }
  await sequelize.transaction(async transaction => {
    await Announcement.create({ title, body, authorId: req.user.id, audience: 'student', published: false }, { transaction });
    await Notification.bulkCreate(recipients.map(student => ({
      userId: student.id, title, message: `From ${req.user.name}: ${body}`, href: '/student/notifications'
    })), { transaction });
    await audit(req.user.id, 'faculty.announcement_sent', 'faculty', req.user.id, { recipients: recipients.length }, transaction);
  });
  req.flash('success_msg', `Announcement sent to ${recipients.length} student(s).`);
  res.redirect('/faculty/announcements');
};
