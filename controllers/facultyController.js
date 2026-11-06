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
  const pending = await PracticalSubmission.count({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, status: 'submitted' } });
  const completed = attempts.filter(a => a.status === 'completed').length;
  render(res, 'dashboard', { title: 'Faculty overview', students: students.slice(0, 8).map(plain), sections: sections.map(plain), studentCount: students.length, courseCount: await Course.count({ where: { ownerId: req.user.id } }), publishedCount: await Course.count({ where: { ownerId: req.user.id, published: true } }), pendingCredentials: await CredentialRequest.count({ where: { facultyId: req.user.id, status: 'pending' } }), active: new Set(attempts.filter(a => a.status !== 'completed').map(a => a.userId)).size, pending, completed, completionRate: attempts.length ? Math.round(completed / attempts.length * 100) : 0, support: students.filter(s => attempts.some(a => a.userId === s.id && a.status !== 'completed' && (!a.lastActivityAt || Date.now() - new Date(a.lastActivityAt) > 7 * 86400000))).map(plain) });
};
export const profile = (req, res) => render(res, 'profile', { title: 'My faculty profile', googleConnected: Boolean(req.user.googleId), returned: req.user.approvalStatus === 'returned' });
export const saveProfile = async (req, res) => { const name = text(req.body.name, 100), facultyPosition = text(req.body.facultyPosition, 120), facultyEducation = text(req.body.facultyEducation, 200), facultyQualifications = text(req.body.facultyQualifications, 2000); if (name.length < 2 || !facultyPosition || !facultyEducation || !facultyQualifications) fail('Complete your name, position, education and qualifications.'); const resubmit = req.user.approvalStatus === 'returned'; await req.user.update({ name, facultyPosition, facultyEducation, facultyQualifications, ...(resubmit ? { approvalStatus: 'pending', facultyReviewedBy: null, facultyReviewedAt: null } : {}) }); if (resubmit) { const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] }); await Notification.bulkCreate(admins.map(admin => ({ userId: admin.id, title: 'Faculty registration resubmitted', message: `${name} updated a returned registration for review.`, href: '/admin/faculty?approval=pending' }))); } req.flash('success_msg', resubmit ? 'Profile updated and returned registration resubmitted for Admin review.' : 'Faculty profile saved.'); res.redirect('/faculty/profile'); };
export const credentials = async (req, res) => {
  const courses = await Course.findAll({ where: { ownerId: req.user.id, published: true, certificateEnabled: true }, attributes: ['id','title','domain','published','certificateEnabled','awardsApproved'], order: [['title', 'ASC']] });
  const requests = await CredentialRequest.findAll({ where: { facultyId: req.user.id }, order: [['updatedAt', 'DESC']] });
  const settings = Object.fromEntries((await Setting.findAll({ where: { key: ['institutionName','adminSignature','certificateSignatory','certificateSignatoryPosition'] } })).map(s => [s.key, s.value]));
  render(res, 'credentials', { title: 'Certificates & badges', facultyName:req.user.name, facultyPosition:req.user.facultyPosition, ...settings, courses: courses.map(c => ({ ...plain(c), request: plain(requests.find(r => r.courseId === c.id)) })) });
};
export const submitCredential = async (req, res) => {
  const signature=await validatedSignature(req.body.signature),label=text(req.body.badgeLabel,60)||'Course completion';
  await sequelize.transaction(async transaction=>{
    const course=await ownedCourse(req,transaction);if(!course.published)fail('Publish your course before requesting a certificate and badge approval.');
    const [request,created]=await CredentialRequest.findOrCreate({where:{courseId:course.id},defaults:{facultyId:req.user.id,facultySignature:signature,badge:{enabled:true,label},status:'pending'},transaction});
    if(!created)await request.update({facultyId:req.user.id,facultySignature:signature,badge:{enabled:true,label},status:'pending',remarks:null,reviewedBy:null,reviewedAt:null},{transaction});
    await course.update({awardsApproved:false},{transaction});
    const attempts=await CourseAttempt.findAll({where:{courseId:course.id},transaction});
    for(const attempt of attempts)await attempt.update({snapshot:{...attempt.snapshot,awardsApproved:false}},{transaction});
    await audit(req.user.id,'credential.requested','course',course.id,{requestId:request.id},transaction);
  });
  req.flash('success_msg','Transparent signature and credential configuration sent to Admin for review. Existing issued awards retain their original signatures.');res.redirect('/faculty/credentials');
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
export const courses = async (req, res) => {
  let courses, databaseNotice='';
  try { courses = await Course.findAll({ where: { ownerId: req.user.id }, order: [['id', 'DESC']] }); }
  catch(error) { console.error('[Faculty course list]',JSON.stringify({resource:'courses',name:error.name,code:error.original?.code||error.parent?.code||null})); courses=[]; databaseNotice='The course list could not read course records. Ask Admin to check the database migration and connection, then refresh.'; }
  const ids = courses.map(c => c.id);
  let attempts=[],requests=[],assignments=[];
  if(ids.length){
    const results=await Promise.allSettled([CourseAttempt.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['courseId','userId','status'] }),CredentialRequest.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['courseId'] }),CourseAssignment.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['courseId'] })]);
    [attempts,requests,assignments]=results.map((result,i)=>{if(result.status==='fulfilled')return result.value;console.error('[Faculty course list]',JSON.stringify({resource:['attempts','credentials','assignments'][i],name:result.reason?.name,code:result.reason?.original?.code||result.reason?.parent?.code||null}));databaseNotice ||= 'Course activity totals are temporarily unavailable. The courses remain accessible; ask Admin to check the latest database migration.';return [];});
  }
  render(res, 'courses', { title: 'My courses', databaseNotice, courses: courses.map(c => { const rows = attempts.filter(a => a.courseId === c.id); const hasHistory = requests.some(r => r.courseId === c.id) || assignments.some(a => a.courseId === c.id) || rows.length > 0; return { ...plain(c), moduleCount: savedArray(c.modules).length, questionCount: savedArray(c.questions).length, enrolledStudents: new Set(rows.map(a => a.userId)).size, activeLearners: new Set(rows.filter(a => a.status !== 'completed').map(a => a.userId)).size, completedAttempts: rows.filter(a => a.status === 'completed').length, deleteEligible: !c.published && !hasHistory }; }) });
};
export const editor = async (req, res) => {
  const course = plain(await ownedCourse(req));
  for(const field of ['modules','questions','tasks','outcomes','prerequisites','policy','competencyAreas']){
    if(typeof course[field]==='string')try{course[field]=JSON.parse(course[field]);}catch{fail('This course contains unreadable saved content. Open its original source to generate a replacement.',422);}
  }
  course.competencyAreas=courseAreas(course.competencyAreas,course.domain);
  const [bank, otherCourses, revisions] = await Promise.all([QuestionBank.findAll({ where: { ownerId: req.user.id, active: true, reviewed: true }, limit: 200 }), Course.findAll({ where: { published: true }, attributes: ['id', 'title'] }), course.id ? CourseRevision.findAll({ where: { courseId: course.id }, attributes:['version','action','createdAt'], order: [['createdAt', 'DESC']], limit: 20 }) : []]);
  render(res, 'editor', { title: 'Revise course', backUrl: '/faculty/courses', course, domains, bank: bank.map(plain), otherCourses: otherCourses.map(plain), revisions: revisions.map(r => ({ ...plain(r), date: date(r.createdAt) })) });
};
export const saveCourse = async (req, res) => {
  const approve=req.body.action==='approve-generated',publish=approve||req.body.action==='publish';
  let input,id;
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
    const data=courseInput(input,{draft:!publish});
    const wasPublished = Boolean(c?.published);
    if (c && data.prerequisites.includes(c.id)) fail('A course cannot require itself.');
    // Every prerequisite must exist and cannot create an indirect cycle.
    for (const prerequisite of data.prerequisites) {
      const seen = new Set(); const visit = async cid => { if (c && cid === c.id) fail('Prerequisites would form a cycle.'); if (seen.has(cid)) return; seen.add(cid); const dependency = await Course.findByPk(cid, { transaction }); if (!dependency) fail('Prerequisite course does not exist.'); for (const next of dependency.prerequisites) await visit(Number(next)); }; await visit(prerequisite);
    }
    if (publish) {
      publishCheck(data);
      const generatedJob = await AiJob.findOne({ where: { courseId: c.id, status: 'completed', type: 'course-draft' }, transaction });
      if (generatedJob) {
        const source = await SourceDocument.findOne({ where: { id: generatedJob.sourceId, ownerId: req.user.id }, transaction });
        const sourceRows = source ? sourceSections(source) : [];
        const norm = value => String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();
        for (const module of data.modules) for (const lesson of module.lessons) {
          const evidence = sourceRows.find(row => row.reference === lesson.sourceReference);
          if (!lesson.sourceReviewed) fail('Review every generated lesson in the editor or confirm the complete review in student preview before publishing.', 422);
          if (!lesson.sourceQuote || !evidence || !norm(evidence.text).includes(norm(lesson.sourceQuote))) {
            lesson.sourceQuote = '';
            lesson.sourceNeedsReview = true;
            if (!evidence) lesson.sourceReference = 'Manual faculty review · no direct citation';
          }
        }
        for (const question of data.questions) {
          const evidence = sourceRows.find(row => row.reference === question.sourceReference);
          if (!question.sourceQuote || !evidence || !norm(evidence.text).includes(norm(question.sourceQuote))) {
            question.sourceQuote = '';
            question.sourceNeedsReview = true;
            if (!evidence) question.sourceReference = 'Manual faculty review · no direct citation';
          }
        }
      }
    }
    { await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'before-edit', snapshot: plain(c) }, { transaction }); await c.update({ ...data, starter: false, awardsApproved: false, version: c.version + 1, published: publish }, { transaction }); await CredentialRequest.update({ status: 'returned', remarks: 'Course content changed. Resubmit the credential configuration for review.' }, { where: { courseId: c.id, status: 'approved' }, transaction }); const attempts = await CourseAttempt.findAll({ where: { courseId: c.id }, transaction }); for (const attempt of attempts) await attempt.update({ snapshot: { ...attempt.snapshot, awardsApproved: false } }, { transaction }); }
    id = c.id;
    if (c.published && !wasPublished) {
      const learners = await User.findAll({ where: { role: 'student', active: true }, attributes: ['id'], transaction });
      await Notification.bulkCreate(learners.map(user => ({ userId: user.id, title: 'New course available', message: `${c.title} is now in the learning catalog.`, href: `/student/courses/${c.id}` })), { transaction });
    }
    await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: c.published ? 'published' : 'draft', snapshot: plain(c) }, { transaction });
    await audit(req.user.id, c.published ? 'course.published' : 'course.draft_saved', 'course', c.id, { version: c.version }, transaction);
  });
  req.flash('success_msg', publish ? 'Course published and available to students. Completion certificates follow the published course rules.' : 'Draft saved. Publishing requires complete assessments and one course-wide review confirmation.'); res.redirect(`/faculty/courses/${id}/edit`);
};
export const archiveCourse = async (req, res) => { const c = await ownedCourse(req); await c.update({ published: false }); await CourseRevision.create({ courseId: c.id, actorId: req.user.id, version: c.version, action: 'archived', snapshot: plain(c) }); await audit(req.user.id, 'course.archived', 'course', c.id); req.flash('success_msg', 'Course archived. Existing attempts remain accessible.'); res.redirect('/faculty/courses'); };
export const deleteDraft = async (req, res) => {
  await sequelize.transaction(async transaction => {
    const course = await ownedCourse(req, transaction);
    if (course.published) fail('Unpublish this course before deleting it.');
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
export const preview = async (req, res) => { const c = await ownedCourse(req); render(res, 'preview', { title: 'Student preview', backUrl: `/faculty/courses/${req.params.id}/edit`, course: plain(c), generated:Boolean(await AiJob.count({where:{courseId:c.id,status:'completed',type:'course-draft'}})), questions: publicQuestions(c.questions) }); };
const sourceValues = body => ({ areas:[].concat(body?.competencyAreas||body?.domain||[]), domain: domains.includes(body?.domain) ? body.domain : '', outcomes: text(body?.outcomes, 1500), level: ['Foundation','Intermediate','Advanced'].includes(body?.level) ? body.level : 'Foundation', questionCount: Math.max(3, Math.min(30, Number(body?.questionCount) || 8)), consent: body?.consent === 'yes' });
const sourceDiagnostics = source => {
  const grouped = new Map();
  for (const section of sourceSections(source)) {
    const key = section.documentKey || section.documentName || source.filename;
    const item = grouped.get(key) || { name: section.documentName || source.filename, sections: 0, characters: 0, references: [] };
    item.sections++; item.characters += section.text.length; item.references.push(section.reference); grouped.set(key, item);
  }
  return [...grouped.values()].map(item => ({ ...item, units: new Set(item.references.map(ref => ref.match(/(?:Page|Slide|Paragraph)\s+\d+/i)?.[0]).filter(Boolean)).size, warning: item.characters < 600 ? 'Low extracted text; check for scanned or mostly empty pages.' : '' }));
};
const sourceView = async (res, source, body, error) => render(res, 'source', { title: 'Review source material', backUrl: '/faculty/upload', source: { ...plain(source), sections: sourceSections(source) }, sourceDiagnostics: sourceDiagnostics(source), domains, aiReady: (await aiConfiguration()).ready, aiProviderLabel: (await aiConfiguration()).label, values: sourceValues(body), error });
export const uploadPage = async (req, res) => render(res, 'upload', { title: 'Upload & generate', domains, aiReady: (await aiConfiguration()).ready, aiProviderLabel: (await aiConfiguration()).label, sources: (await SourceDocument.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'DESC']], attributes: ['id', 'filename'], limit: 20 })).map(plain), jobs: (await AiJob.findAll({ where: { userId: req.user.id }, attributes:['id','createdAt','status','errorCode','courseId'], order: [['createdAt', 'DESC']], limit: 20 })).map(j => ({ ...plain(j), date: date(j.createdAt) })) });
export const upload = async (req, res) => {
  const json=req.get('accept')?.includes('application/json');
  const progressStream=req.get('accept')?.includes('application/x-ndjson');
  const emit=event=>{if(!progressStream)return;if(!res.headersSent){res.status(200).type('application/x-ndjson');res.set('Cache-Control','no-cache, no-transform');res.set('X-Accel-Buffering','no');res.flushHeaders?.();}res.write(`${JSON.stringify(event)}\n`);res.flush?.();};
  const reject=(message,status=422)=>{if(progressStream){if(!res.headersSent)res.status(status).type('application/x-ndjson').set('Cache-Control','no-cache, no-transform');res.write(`${JSON.stringify({ok:false,message,done:true})}\n`);return res.end();}if(json)return res.status(status).json({ok:false,message});req.flash('error_msg',message);return res.redirect('/faculty/upload');};
  const files=req.files||(req.file?[req.file]:[]),sourceId=req.body.sourceId;
  if(!files.length)return reject('Choose at least one PDF, DOCX, PPTX or TXT file.');
  if(files.reduce((n,f)=>n+f.buffer.length,0)>sourceLimits.requestBytes)return reject('Upload at most 100 MB per request. The upload queue sends one file at a time.',413);
  if(sourceId && (!/^\d+$/.test(sourceId)||!await SourceDocument.findOne({where:{id:sourceId,ownerId:req.user.id}})))return reject('Source collection not found.',404);
  const extracted=[],failed=[];
  for(const file of files){
    try{
      const key=createHash('sha256').update(file.buffer).digest('hex');
      emit({phase:'extracting',filename:text(file.originalname,120),current:0,total:0,unit:'pages'});
      const sections=await extractSource(file,{onProgress:progress=>emit({...progress,filename:text(file.originalname,120)})});
      extracted.push({name:text(file.originalname,120),key,sections:sections.map(section=>({...section,documentKey:key,documentName:text(file.originalname,120),reference:`${text(file.originalname,80)} [${key.slice(0,8)}] · ${section.reference}`}))});
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
      const saved=row?await row.update({filename,sections},{transaction}):await SourceDocument.create({ownerId:req.user.id,filename,sections},{transaction});
      await audit(req.user.id,'source.uploaded','source',saved.id,{files:extracted.length,failedFiles:failed.length,sections:sections.length},transaction);return saved;
    });
  }catch(error){if(error.status)return reject(error.message,error.status);const safe=safeGenerationError(error,'upload-save');return reject(`${safe.message} Reference: ${safe.reference}`,safe.status);}
  const redirect=`/faculty/sources/${source.id}`;
  if(progressStream){if(!res.headersSent)res.status(200).type('application/x-ndjson').set('Cache-Control','no-cache, no-transform');res.write(`${JSON.stringify({ok:true,done:true,sourceId:source.id,redirect,failed,duplicates:[...new Set(duplicateFiles)],files:extracted.map(f=>f.name)})}\n`);return res.end();}
  if(json)return res.json({ok:true,sourceId:source.id,redirect,failed,duplicates:[...new Set(duplicateFiles)],files:extracted.map(f=>f.name)});
  const notes=[...failed.map(f=>`${f.filename}: ${f.message}`),...(duplicateFiles.length?[`Duplicate files skipped: ${[...new Set(duplicateFiles)].join(', ')}.`]:[])];
  req.flash(notes.length?'error_msg':'success_msg',notes.length?notes.join(' · '):'Source collection saved. Review its extraction quality, then create a blueprint before generating lessons and assessments.');res.redirect(redirect);
};
export const resumeGeneration = async (req,res) => {
  const invalid=(message,status=400)=>res.status(status).json({ok:false,message});
  try{
    const previous=await AiJob.findOne({where:{id:req.params.id,userId:req.user.id,type:'course-draft'}});
    if(!previous)return invalid('Generation request not found.',404);
    if(previous.status==='completed'&&previous.courseId)return res.json({ok:true,redirect:`/faculty/generation/${previous.id}`});
    const config=await aiConfiguration(),providers=config.fallback?['gemini','groq']:[config.provider];
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
  render(res,'generation',{title:'Generating your course',progress});
};
export const source = async (req, res) => { const s = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!s) fail('Source not found.', 404); await sourceView(res, s); };
export const deleteSource = async (req, res) => { const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404); await audit(req.user.id, 'source.deleted', 'source', source.id, { filename: source.filename }); await source.destroy(); req.flash('success_msg', 'Source resource deleted. Existing courses and generated drafts are unchanged.'); res.redirect('/faculty/upload'); };
export const generate = async (req, res) => {
  const source = await SourceDocument.findOne({ where: { id: req.params.id, ownerId: req.user.id } }); if (!source) fail('Source not found.', 404);
  try {
    if(req.body.mode==='manual')throw generationError('COURSE_INPUT','Select Generate course to create lessons and assessments from these materials.');
    const selected=courseAreas([].concat(req.body.competencyAreas||req.body.domain||[]),req.body.domain);
    req.body.domain=selected[0];req.body.competencyAreas=selected;
    const values=sourceValues(req.body);
    if (!domains.includes(req.body.domain)) throw generationError('COURSE_INPUT', 'Choose the competency area for this course.');
    if (req.body.consent !== 'yes') throw generationError('COURSE_INPUT', 'Enter target outcomes and confirm permission to share this source with the selected AI provider.');
    if(req.body.background==='yes'){
      const job=await startBlueprintJob(req.user.id,source,{...req.body,outcomes:values.outcomes || 'Derive learning outcomes from the supplied materials.'});
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
  if (req.query.export === 'csv') { const cell = v => '"' + (/^[\s]*[=+@-]/.test(String(v ?? '')) ? "'" : '') + String(v ?? '').replaceAll('"', '""') + '"'; res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="assigned-student-progress.csv"' }); return res.send('\uFEFF' + [['Student','Section','Course','Attempt','Status','Final knowledge score','Active minutes','Elapsed days','Last activity'], ...attempts.map(a => [a.student.name,a.student.section,a.title,a.attemptNumber,a.status,a.finalScore,a.minutes,a.elapsedDays,a.lastActivity])].map(r => r.map(cell).join(',')).join('\n')); }
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

