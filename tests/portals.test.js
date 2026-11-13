import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { browser } from './httpHelpers.js';
process.env.NODE_ENV = 'test'; process.env.TEST_DB_STORAGE = ':memory:';
const { sequelize, User, Course, CourseAttempt, StudentProfile, Credential, Notification } = await import('../models/learningModels.js');
const { Section, Setting } = await import('../models/adminModels.js');
const { CourseRevision, PracticalSubmission, SourceDocument, AiJob, QuizDraft, ProfileCorrection, CredentialRequest } = await import('../models/portalModels.js');
const { seedAdministration } = await import('../services/accounts.js');
const { domains } = await import('../data/starterCourses.js');
const { courseInput, publishCheck } = await import('../services/courseAuthoring.js');
const { extractSource } = await import('../services/sourceExtraction.js');
const { generateCourse } = await import('../services/courseAi.js');
const { startServer, closeResources } = await import('../index.js');
const { checkQuizLimits } = await import('../services/portalLearning.js');
const { issueChallenge } = await import('../services/learning.js');
const content = () => ({ title: 'Tourism service practice', description: 'Build evidence through structured learning and a practical service response.', domain: domains[0], level: 'Foundation', minutes: 60, passingScore: 75, outcomes: ['Apply a safe tourism service workflow.'], modules: [{ id:'m1', title:'Service fundamentals', lessons:[{ id:'l1', title:'A professional service workflow', body:'Confirm the guest requirements before making a recommendation. Check the information carefully and communicate the next steps clearly.', takeaways:['Confirm the request first.'] }] }], questions: [{id:'q1',moduleId:'m1',domain:domains[0],prompt:'What should you do before recommending a service?',options:['Confirm the requirements','Ignore the request','Skip the checks'],answer:0,explanation:'Confirm requirements before recommending.',reviewed:true,sourceReference:'Paragraph 1',sourceQuote:'Confirm the guest requirements before making a recommendation.'}], tasks:[{ id:'t1', title:'Guest response', instructions:'Write a professional response confirming guest requirements and the proposed next step.', rubric:[{id:'accuracy',label:'Accuracy and application',max:10},{id:'communication',label:'Clear communication',max:10}] }], policy:{pretest:true,feedbackRequired:true,quizMinutes:0,attemptLimit:3,quizWeight:30,finalWeight:40,practicalWeight:30}, prerequisites:[], certificateEnabled:true });
await test('course validation blocks incomplete, unreviewed, invalid and cyclic requirements at their boundary',()=>{
  const draft=content(); draft.awardsApproved=true; publishCheck(courseInput(draft));
  assert.throws(()=>courseInput({...draft,passingScore:101}));
  assert.throws(()=>courseInput({...draft,questions:[{...draft.questions[0],options:['same','same']}]}));
  assert.throws(()=>courseInput({...draft,policy:{...draft.policy,finalWeight:80}}));
  assert.throws(()=>publishCheck({...draft,questions:[{...draft.questions[0],reviewed:false}]}));
  assert.throws(()=>publishCheck({...draft,modules:[{id:'m1',title:'Empty',lessons:[]}]}));
});
await test('time and submission limits are enforced server-side',()=>{
  const attempt={snapshot:{policy:{quizMinutes:1,attemptLimit:2}},quizAttempts:[{scope:'m1'},{scope:'m1'}]};
  assert.throws(()=>checkQuizLimits(attempt,'m1',{startedAt:new Date()}),/limit/);
  assert.throws(()=>checkQuizLimits({...attempt,quizAttempts:[]},'m1',{startedAt:new Date(Date.now()-61000)}),/expired/);
  assert.doesNotThrow(()=>checkQuizLimits({...attempt,quizAttempts:[]},'m1',{startedAt:new Date()}));
});
await test('completed practical evidence blends once with the matching latest completed attempt',async()=>{
  const {careerMatches}=await import('../services/learning.js');const a={id:1,courseId:9,status:'completed',completedAt:'2026-10-01',snapshot:{domain:domains[0],tasks:[{id:'t1'}]},finalScore:80};
  let result=careerMatches([a],null,'',undefined,[{attemptId:1,taskId:'t1',grade:100}]);assert.equal(result.scores[domains[0]],86);assert.equal(result.knowledgeScores[domains[0]],80);assert.equal(result.practicalScores[domains[0]],100);
  const retake={...a,id:2,completedAt:'2026-10-02',finalScore:90};result=careerMatches([a,retake],null,'',undefined,[{attemptId:1,taskId:'t1',grade:100}]);assert.equal(result.scores[domains[0]],90,'old rubric must not stack into latest retake');
  result=careerMatches([{...a,status:'ongoing'}],null,'',undefined,[{attemptId:1,taskId:'t1',grade:100}]);assert.equal(result.scores[domains[0]],null);
});
await test('PDF, DOCX and PPTX extraction preserves references and keeps low-text files available for manual review',async()=>{
  const sentence='Confirm the guest requirements before making a recommendation. Check safety, accessibility, reservation details and communicate clearly. '.repeat(4);
  const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${sentence}</w:t></w:r></w:p></w:body></w:document>`);
  const docx=await zip.generateAsync({type:'nodebuffer'});let result=await extractSource({originalname:'source.docx',buffer:docx});assert.equal(result[0].reference,'Paragraph 1');assert.ok(result[0].text.includes('accessibility'));
  const ppt=new JSZip();ppt.file('ppt/slides/slide1.xml',`<p:sld><a:t>${sentence}</a:t></p:sld>`);result=await extractSource({originalname:'source.pptx',buffer:await ppt.generateAsync({type:'nodebuffer'})});assert.equal(result[0].reference,'Slide 1');
  const pdf=new PDFDocument();const chunks=[];const ready=new Promise(resolve=>{pdf.on('data',c=>chunks.push(c));pdf.on('end',()=>resolve(Buffer.concat(chunks)));});pdf.text(sentence);pdf.end();result=await extractSource({originalname:'source.pdf',buffer:await ready});assert.equal(result[0].reference,'Page 1');
  await assert.rejects(()=>extractSource({originalname:'fake.pdf',buffer:Buffer.from('not a pdf')}));
  const blank=new JSZip();blank.file('ppt/slides/slide1.xml','<a:t>Hi</a:t>');await assert.rejects(()=>extractSource({originalname:'scan.pptx',buffer:Buffer.from('PK')}));
  const blankBytes=await blank.generateAsync({type:'nodebuffer'});result=await extractSource({originalname:'short.pptx',buffer:blankBytes});assert.equal(result[0].text,'Hi','low-text files stay available for faculty review instead of failing extraction');
});
await test('complete Faculty→Student→rubric→award workflow, scopes, versioning, drafts, assignments and academic corrections',async()=>{
  await sequelize.sync({force:true});await seedAdministration();const hash=await bcrypt.hash('TestingPassword-2026!',4);
  const faculty=await User.create({name:'Faculty Author',email:'faculty@example.test',facultyId:'FAC-01',role:'faculty',approvalStatus:'approved',password:hash});
  const otherFaculty=await User.create({name:'Other Faculty',email:'other@example.test',facultyId:'FAC-02',role:'faculty',approvalStatus:'approved',password:hash});
  const student=await User.create({name:'Learning Student',email:'student@example.test',studentId:'STU-01',section:'BSTM 4-1',gender:'Female',role:'student',password:hash});
  const outsider=await User.create({name:'Outside Student',email:'outside@example.test',studentId:'STU-02',section:'BSTM 4-2',gender:'Male',role:'student',password:hash});
  const admin=await User.create({name:'Portal Admin',email:'admin@example.test',role:'admin',password:hash});
  await StudentProfile.create({userId:student.id,yearLevel:'Graduating',academicYear:'2026-2027',graduationYear:'2027',ojtStatus:'Not yet started',careerInterest:'Travel',preferredLocation:'Philippines',complete:true});
  await StudentProfile.create({userId:outsider.id,yearLevel:'Graduating',academicYear:'2026-2027',graduationYear:'2027',ojtStatus:'Not yet started',careerInterest:'Travel',preferredLocation:'Philippines',complete:true});
  await Section.update({facultyId:faculty.id},{where:{name:'BSTM 4-1'}});
  const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
  const f=browser(base),s=browser(base),o=browser(base),a=browser(base),f2=browser(base);
  try{
    for(const [client,user] of [[f,faculty],[s,student],[o,outsider],[a,admin],[f2,otherFaculty]]){await client.login(user.email,'TestingPassword-2026!');await client.get('/'+user.role);}
    for(const path of ['/faculty','/faculty/courses','/faculty/upload','/faculty/questions','/faculty/students','/faculty/students/'+student.id,'/faculty/monitoring','/faculty/reports','/faculty/assignments','/faculty/evaluations','/faculty/announcements','/faculty/profile','/notifications'])assert.equal((await f.get(path)).status,200,path);
    for(const path of ['/admin/academic','/admin/ai','/admin/competencies','/admin/maintenance','/notifications'])assert.equal((await a.get(path)).status,200,path);
    await a.get('/admin/settings');
    const oldGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'admin-controls-test-key';
    assert.equal((await f.post('/admin/settings/course-ai',{provider:'groq',enabled:'true',groqEnabled:'true'})).status,403);
    assert.equal((await a.post('/admin/settings/course-ai',{provider:'groq',enabled:'true',groqEnabled:'true'})).status,302);
    const {courseAiConfiguration} = await import('../services/courseAiProvider.js');
    assert.equal((await courseAiConfiguration()).provider,'groq');
    assert.equal((await courseAiConfiguration()).ready,true);
    assert.equal((await courseAiConfiguration()).geminiEnabled,false);
    assert.equal((await a.post('/admin/settings/course-ai',{provider:'groq',groqEnabled:'true'})).status,302);
    assert.equal((await courseAiConfiguration()).ready,false);
    const aiSettings = await a.get('/admin/settings');
    assert.equal(aiSettings.status,200);
    assert.ok(!aiSettings.html.includes('admin-controls-test-key'));
    await Setting.destroy({where:{key:['courseAiProvider','courseAiEnabled','courseGeminiEnabled','courseGroqEnabled']}});
    if(oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY=oldGroqKey;
    assert.equal((await f.get('/faculty/students/'+outsider.id)).status,404);
    assert.equal((await f2.get('/faculty/students/'+student.id)).status,404);
    let draft=content();let r=await f.post('/faculty/courses',{courseData:JSON.stringify({...draft,questions:[{...draft.questions[0],reviewed:false}]}),action:'publish'});assert.equal(r.status,400);assert.equal(await Course.count(),0);
    assert.equal((await f.get('/faculty/courses/new')).location,'/faculty/upload');
    const c=await Course.create({...draft,ownerId:faculty.id,slug:'legacy-published',published:true});
    await CourseRevision.create({courseId:c.id,version:1,actorId:faculty.id,action:'published',snapshot:draft});
    await c.update({modules:JSON.stringify(draft.modules)});
    const legacyEditor=await f.get('/faculty/courses/'+c.id+'/edit');
    assert.equal(legacyEditor.status,200);
    assert.match(legacyEditor.html,/&quot;modules&quot;:\s*\[/);
    assert.equal((await f.get('/faculty/courses')).status,200);
    r=await f.get('/faculty/credentials');assert.equal(r.status,200);
    for(const logo of ['/images/certificates/minsu-seal.png','/images/certificates/cbm-logo.png','/images/certificates/cts-logo.png'])assert.ok(r.html.includes(logo),`faculty certificate preview includes ${logo}`);
    await c.update({modules:draft.modules});
    assert.equal((await f2.post(`/faculty/courses/${c.id}`,{courseData:JSON.stringify(draft),action:'publish'})).status,404);
    assert.equal((await s.get(`/faculty/courses/${c.id}/edit`)).status,403);
    const section=await Section.findOne({where:{name:'BSTM 4-1'}});await f.get('/faculty/assignments');r=await f.post('/faculty/assignments',{courseId:c.id,sectionId:section.id,required:'true',dueAt:'2027-01-10T12:00'});assert.equal(r.status,302);
    const moduleUrl = `/student/courses/${c.id}/modules/m1`;
    assert.equal((await s.post(moduleUrl + '/save', {})).status, 302);
    const savedModulePage = await s.get('/student/courses?view=saved');
    assert.match(savedModulePage.html, /saved-module-card/);
    assert.doesNotMatch(savedModulePage.html, /Module 1/);
    assert.match(savedModulePage.html, /Service fundamentals/);
    assert.doesNotMatch(savedModulePage.html, /View modules/);
    assert.match((await s.get(`/student/courses/${c.id}`)).html, /Remove saved module/);
    assert.equal((await s.post(moduleUrl + '/unsave', {})).status, 302);
    r=await s.get('/student/courses');assert.match(r.html,/Required learning/);r=await s.post(`/student/courses/${c.id}/enroll`);assert.equal(r.status,302);const attempt=await CourseAttempt.findOne({where:{userId:student.id}}),id=attempt.id;
    r=await s.get(`/student/learn/${id}/quiz/m1`);assert.equal(r.status,403,'pretest required');r=await s.get(`/student/learn/${id}/quiz/pretest`);assert.equal(r.status,200);assert.ok(!r.html.includes('"answer":0'));
    assert.doesNotMatch(legacyEditor.html, /Attach original file/);
    const originalBytes = Buffer.from('%PDF-1.7\nOriginal faculty learning material');
    const attachment = new FormData();
    attachment.set('moduleId', 'm1');
    attachment.set('material', new Blob([originalBytes]), 'module.pdf');
    const attach = client => client.request(`/faculty/courses/${c.id}/material`, {
      method: 'POST', headers: { 'X-CSRF-Token': client.csrf }, body: attachment
    });
    assert.equal((await attach(f2)).status, 404);
    assert.equal((await attach(f)).status, 200);
    assert.equal((await attach(f)).status, 200);
    await attempt.reload();
    await c.reload();
    assert.equal(c.published, true);
    assert.equal(c.version, 1);
    assert.deepEqual(c.questions, draft.questions);
    assert.equal(c.modules[0].materials.length, 1);
    assert.deepEqual(attempt.snapshot.modules[0].materials, c.modules[0].materials);
    const [material] = c.modules[0].materials;
    const materialUrl = `/student/learn/${id}/materials/m1/${material.sourceId}/${material.documentKey}`;
    const materialResponse = await s.get(materialUrl);
    assert.equal(materialResponse.status, 200);
    assert.equal(materialResponse.html, originalBytes.toString());
    assert.equal((await o.get(materialUrl)).status, 404);
    const confirmUrl = '/student/learn/' + id + '/materials/m1/confirm';
    assert.equal((await s.post(confirmUrl, {})).status, 400);
    const token=scope=>issueChallenge(student.id,`${id}:${scope}`);
    const answer=scope=>s.post(`/student/learn/${id}/${scope==='final'?'final':'quiz/'+scope}`,{challenge:token(scope),'answers[q1]':'0'});
    assert.equal((await answer('pretest')).status,302);
    r=await s.get(`/student/learn/${id}?lesson=l1`);
    assert.doesNotMatch(r.html, /data-lesson-challenge=/);
    assert.doesNotMatch((await s.get('/student/learning')).html, /class="card learning-card"/);
    assert.equal((await s.get(`/student/learn/${id}/quiz/m1`)).status, 403);
    assert.equal((await s.post(confirmUrl, { read: 'yes' })).location, `/student/learn/${id}?lesson=l1`);
    assert.match((await s.get('/student/learning')).html, /Continue Learning/);
    const startedCard = (await s.get(`/student/courses/${c.id}`)).html;
    assert.match(startedCard, /role="progressbar"/);
    assert.doesNotMatch(startedCard, /Save module/);
    r=await s.get(`/student/learn/${id}?lesson=l1`);
    const lessonChallenge=r.html.match(/data-lesson-challenge="([^"]+)"/)[1];
    r=await s.post(`/student/learn/${id}/complete`,{lessonId:'l1'});assert.equal(r.status,400);
    r=await s.post(`/student/learn/${id}/complete`,{lessonId:'l1',lessonChallenge});assert.equal(r.location,`/student/learn/${id}?lesson=l1#topic-quiz`);
    const inlineQuiz = await s.get(`/student/learn/${id}?lesson=l1`);
    assert.match(inlineQuiz.html, /1\.1 Quiz/);
    assert.match(inlineQuiz.html, /name="answers\[q1\]"/);
    await s.get(`/student/learn/${id}/quiz/m1`);
    r=await s.request(`/student/learn/${id}/draft/m1?topic=l1`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({revision:0,answers:{q1:'0'}})});assert.equal(r.status,200);assert.equal(JSON.parse(r.html).revision,1);
    r=await s.request(`/student/learn/${id}/draft/m1`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({revision:0,answers:{q1:'1'}})});assert.equal(r.status,409,'stale tab cannot overwrite');
    r=await s.get(`/student/learn/${id}/quiz/m1`);assert.match(r.html,/value="0"\s+checked/,'saved answer restored');
    assert.equal((await o.get(`/student/learn/${id}/quiz/m1`)).status,404);
    const moduleResult = await answer('m1');
    assert.equal(moduleResult.status, 302);
    assert.match((await s.get(moduleResult.location)).html, /Passed/);
    const assessmentAttempt = await CourseAttempt.findByPk(id);
    const originalSnapshot = assessmentAttempt.snapshot;
    await assessmentAttempt.update({ snapshot: { ...originalSnapshot, questions: [
      ...originalSnapshot.questions, { ...originalSnapshot.questions[0], id: 'q2', prompt: 'What should you verify first?' }
    ] } });
    const finalUrl = `/student/learn/${id}/final`;
    const initialOrder = [...(await s.get(finalUrl)).html.matchAll(/name="answers\[(q[12])\]"/g)].map(match => match[1]);
    const failedFinal = await s.post(finalUrl, { challenge: token('final'), 'answers[q1]': '1', 'answers[q2]': '1' });
    assert.equal(failedFinal.status, 302);
    const failedResult = await s.get(failedFinal.location);
    assert.match(failedResult.html, /Below passing score/);
    assert.equal((await s.get(`/student/learn/${id}/review/final`)).status, 403);
    assert.match(failedResult.html, /Would you like to try again/);
    assert.equal((await o.get(failedFinal.location)).status, 404);
    assert.equal(await Credential.count(), 0);
    const retryOrder = [...(await s.get(finalUrl)).html.matchAll(/name="answers\[(q[12])\]"/g)].map(match => match[1]);
    assert.equal(new Set(retryOrder).size, 2);
    assert.notEqual(retryOrder[0], initialOrder[0]);
    const passedFinal = await s.post(finalUrl, { challenge: token('final'), 'answers[q1]': '0', 'answers[q2]': '0' });
    assert.equal(passedFinal.status, 302);
    await assessmentAttempt.update({ snapshot: originalSnapshot });
    assert.match((await s.get(passedFinal.location)).html, /Review submitted final feedback/);
    assert.equal((await s.get(`/student/learn/${id}/review/final`)).status, 200);
    assert.equal((await CourseAttempt.findByPk(id)).status,'ongoing');assert.equal(await Credential.count(),0,'practical and feedback gate awards');
    await f.get(`/faculty/courses/${c.id}/edit`);r=await f.post(`/faculty/courses/${c.id}`,{courseData:JSON.stringify({...draft,title:'Updated course version'}),action:'publish'});assert.equal(r.status,302);assert.equal((await Course.findByPk(c.id)).version,2);assert.equal((await CourseAttempt.findByPk(id)).snapshot.title,draft.title);assert.ok(await CourseRevision.count()>=3);
    assert.equal((await Course.findByPk(c.id)).published, false);
    assert.equal((await s.get('/student/courses/' + c.id)).status, 404);
    const pendingCourses = await a.get('/admin/courses?status=pending');
    assert.match(pendingCourses.html, /Pending publication \(1\)/);
    assert.ok(pendingCourses.html.includes('/admin/courses/' + c.id + '/approve-publication'));
    assert.match((await f.get('/faculty/courses?status=pending')).html, /UPDATED COURSE VERSION/);
    assert.equal((await a.post('/admin/courses/' + c.id + '/approve-publication', { version: 1 })).status, 400);
    assert.equal((await a.post('/admin/courses/' + c.id + '/approve-publication', { version: 2 })).status, 400);
    const signature='data:image/png;base64,'+(await readFile(new URL('../public/images/icons/careerbridge-192.png',import.meta.url))).toString('base64');
    await Setting.upsert({ key: `facultySignature:${faculty.id}`, value: signature });
    const credentialRequest = await CredentialRequest.create({ courseId:c.id, facultyId:faculty.id, facultySignature:signature, status:'pending' });
    assert.equal((await a.post('/admin/courses/' + c.id + '/approve-publication', { version: 2 })).status, 302);
    assert.equal((await credentialRequest.reload()).status, 'approved');
    assert.equal(credentialRequest.badge.label, 'UPDATED COURSE VERSION');
    const duplicate = await Course.create({ ...draft, title: 'Updated course version', slug: 'duplicate-course-test', ownerId: faculty.id, published: false });
    assert.match((await a.get('/admin/courses')).html, new RegExp(`/admin/courses/${duplicate.id}/delete-duplicate`));
    assert.equal((await a.post(`/admin/courses/${duplicate.id}/delete-duplicate`)).status, 302);
    assert.equal(await Course.findByPk(duplicate.id), null);
    assert.equal((await a.post(`/admin/courses/${c.id}/delete-duplicate`)).status, 400);
    assert.equal((await Course.findByPk(c.id)).published, true);
    r=await s.post(`/student/learn/${id}/activities/t1`,{response:'Thank you for your request. Could you confirm the travel dates, number of guests and accessibility requirements?',link:'https://example.test/evidence'});assert.equal(r.status,302);const sub=await PracticalSubmission.findOne();
    await f2.get('/faculty/evaluations');assert.equal((await f2.post(`/faculty/evaluations/${sub.id}`,{'scores[accuracy]':'10','scores[communication]':'10',feedback:'Good evidence.'})).status,404);
    await f.get('/faculty/evaluations');r=await f.post(`/faculty/evaluations/${sub.id}`,{'scores[accuracy]':'11','scores[communication]':'10',feedback:'Good evidence.'});assert.equal(r.status,400);
    r=await f.post(`/faculty/evaluations/${sub.id}`,{'scores[accuracy]':'10','scores[communication]':'10',feedback:'Clear and accurate response.'});assert.equal(r.status,302);assert.equal(await Credential.count(),0,'feedback still required');
    r=await s.get(`/student/learn/${id}/activities`);assert.match(r.html,/Clear and accurate/);r=await s.post(`/student/learn/${id}/feedback`,{rating:'5',comment:'Useful practice.'});assert.equal(r.status,302);assert.equal((await CourseAttempt.findByPk(id)).status,'completed');assert.equal(await Credential.count(),1);
    const award=await Credential.findOne();r=await s.get(`/student/credentials/${award.id}/certificate`);assert.equal(r.status,200);assert.equal(r.response.headers.get('content-type'),'application/pdf');
    assert.equal((await o.get(`/student/credentials/${award.id}/certificate`)).status,404);
    r=await s.get(`/student/credentials/${award.id}/certificate?view=1`);assert.match(r.response.headers.get('content-disposition'),/^inline;/);
    assert.equal((await o.get(`/student/credentials/${award.id}/certificate?view=1`)).status,404);
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    await award.update({courseTitle:'Tourism operations and professional communication '.repeat(3).slice(0,160),recipientName:'Student With An Extended Full Name '.repeat(3).slice(0,100),facultySignature:null,adminSignature:null});
    await Setting.upsert({key:'adminSignature',value:''}); await CredentialRequest.update({status:'returned'},{where:{courseId:c.id}});
    for(const template of ['classic','modern']) { await Setting.upsert({key:'certificateTemplate',value:template}); const pdfResponse=await fetch(base+`/student/credentials/${award.id}/certificate`,{headers:{cookie:s.cookie}});const bytes=new Uint8Array(await pdfResponse.arrayBuffer());const loading=getDocument({data:bytes,isEvalSupported:false});try{const pdf=await loading.promise;assert.equal(pdf.numPages,1,template+' certificate must stay on one page');const text=(await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str||'').join(' ');assert.ok(text.includes('Certificate of Completion'));assert.ok(text.includes('Cert ID'));assert.ok(text.includes('Completion Date'));assert.doesNotMatch(text,/Course version|Final grade|Issued|Verify:/);}finally{await loading.destroy();}}

    r=await f.post(`/faculty/evaluations/${sub.id}`,{'scores[accuracy]':'5','scores[communication]':'5',feedback:'Changed.'});assert.equal(r.status,400,'completed records immutable');
    await f.get('/faculty/students/'+student.id);await f.post('/faculty/students/'+student.id+'/notes',{feedback:'Keep practicing itinerary explanations.',remediation:'Review digital tools.',visibility:'student'});r=await s.get('/student/results');assert.match(r.html,/Keep practicing/);
    await f.post('/faculty/students/'+student.id+'/notes',{feedback:'Private intervention note.',visibility:'internal'});r=await s.get('/student/results');assert.ok(!r.html.includes('Private intervention note'));
    await f.get('/faculty/announcements');await f.post('/faculty/announcements',{title:'Assigned update',body:'Your next learning task is ready.',audience:'students',studentIds:[student.id]});assert.match((await Notification.findOne({where:{userId:student.id,title:'Assigned update'}})).message, /From /);assert.equal(await Notification.count({where:{userId:outsider.id,title:'Assigned update'}}),0);
    r=await s.get('/notifications/count');assert.ok(JSON.parse(r.html).unread>0);
    const notification=await Notification.create({userId:student.id,title:'Read one notice',message:'A single notification should update this account count.',href:'/student'});
    await new Promise(resolve=>setTimeout(resolve,3));
    const remainingNotice=await Notification.create({userId:student.id,title:'Keep this unread notice',message:'Opening another notification should leave this one visible.',href:'/student'});
    const outsiderNotice=await Notification.create({userId:outsider.id,title:'Private notice',message:'This belongs to another account.',href:'/student'});
    r=await s.get('/notifications/feed');let feed=JSON.parse(r.html);assert.ok(feed.notifications.some(item=>item.id===notification.id));assert.ok(feed.notifications.some(item=>item.id===remainingNotice.id));
    assert.equal((await o.post(`/notifications/${notification.id}/open`)).status,404);
    const beforeOpen=await Notification.count({where:{userId:student.id,readAt:null}});
    assert.equal((await s.post(`/notifications/${notification.id}/open`)).status,302);
    assert.equal(await Notification.count({where:{userId:student.id,readAt:null}}),beforeOpen-1);
    r=await s.get('/notifications/feed');feed=JSON.parse(r.html);assert.ok(!feed.notifications.some(item=>item.id===notification.id),'read notification disappears from dropdown feed');assert.ok(feed.notifications.some(item=>item.id===remainingNotice.id),'other unread notifications stay in dropdown');
    r=await s.request('/notifications/read',{method:'POST',headers:{Accept:'application/json','X-CSRF-Token':s.csrf}});
    assert.equal(r.status,200);assert.equal(JSON.parse(r.html).unread,0);
    r=await s.get('/notifications/feed');feed=JSON.parse(r.html);assert.equal(feed.unread,0);assert.equal(feed.notifications.length,0,'mark all clears all dropdown notification content');
    assert.equal((await Notification.findByPk(outsiderNotice.id)).readAt,null,'mark all as read must only update the current user');
    await f.get('/faculty/upload');const zip=new JSZip();zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${draft.questions[0].sourceQuote.repeat(8)}</w:t></w:r></w:p></w:body></w:document>`);const form=new FormData();form.append('sources',new Blob([await zip.generateAsync({type:'nodebuffer'})]),'teaching.docx');r=await f.request('/faculty/upload',{method:'POST',headers:{'X-CSRF-Token':f.csrf},body:form});assert.equal(r.status,302);const uploaded=await SourceDocument.findOne({where:{filename:'teaching.docx'}});assert.ok(uploaded.sections[0].text);assert.equal((await f2.get(`/faculty/sources/${uploaded.id}`)).status,404);
    await s.get('/student/profile');const photo=new FormData();photo.append('kind','photo');photo.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=','base64')]),'profile.png');r=await s.request('/student/profile/files',{method:'POST',headers:{'X-CSRF-Token':s.csrf},body:photo});assert.equal(r.status,302);const {StudentFile}=await import('../models/portalModels.js');const file=await StudentFile.findOne();assert.equal((await o.get('/files/'+file.id)).status,404);assert.equal((await f.get('/files/'+file.id)).status,200);assert.equal((await s.get('/files/'+file.id)).status,200);
    await f.get('/faculty/questions');r=await f.post('/faculty/questions',{prompt:'What must you confirm before recommending?',options:JSON.stringify(['Guest requirements','Nothing']),answer:'0',explanation:'Confirm the guest requirements.',domain:domains[0],reviewed:'true'});assert.equal(r.status,302);r=await f.get('/faculty/questions');assert.match(r.html,/What must you confirm/);
    await f.get(`/faculty/courses/${c.id}/edit`);r=await f.post(`/faculty/courses/${c.id}`,{courseData:JSON.stringify({...draft,prerequisites:[c.id]}),action:'publish'});assert.equal(r.status,400,'self-prerequisite rejected');
    await s.get('/student/profile');r=await s.post('/student/profile/correction',{studentId:'STU-CORRECTED',section:'BSTM 4-2',reason:'Correcting the registered academic section.'});assert.equal(r.status,302);assert.equal((await User.findByPk(student.id)).section,'BSTM 4-1');const correction=await ProfileCorrection.findOne();await a.get('/admin/academic');assert.equal((await a.post(`/admin/academic/${correction.id}`,{status:'approved'})).status,302);assert.equal((await User.findByPk(student.id)).section,'BSTM 4-2');assert.equal((await f.get('/faculty/students/'+student.id)).status,200,'preserve access to the student record for existing course history');
    const moduleDraft = await CourseRevision.create({
      courseId: c.id, actorId: faculty.id, version: 2, action: 'module-draft',
      snapshot: {
        module: { ...draft.modules[0], id: 'm2', title: 'Independent module', skills: ['Practice'], lessons: [{ ...draft.modules[0].lessons[0], id: 'l2', body: 'Independent practice for an additional tourism topic area.' }] },
        questions: [{ ...draft.questions[0], id: 'q2', moduleId: 'm2' }]
      }
    });
    const draftCards = await f.get('/faculty/courses?list=drafts&course=' + c.id);
    assert.equal(draftCards.status, 200);
    assert.match(draftCards.html, /Independent module/);
    assert.doesNotMatch(draftCards.html, /Unpublish/);
    assert.equal((await f.post(`/faculty/courses/${c.id}/modules/${moduleDraft.id}/topics`, {
      moduleTitle: 'Independent module', topicTitle: 'Revised topic area', topicBody: 'Updated independent practice for an additional tourism topic area.'
    })).status, 302);
    assert.equal((await moduleDraft.reload()).snapshot.module.lessons[0].title, 'Revised topic area');
    assert.equal((await f.post(`/faculty/courses/${c.id}/modules/${moduleDraft.id}/submit`, { confirmReview: 'yes' })).status, 302);
    assert.deepEqual((await c.reload()).modules.map(module => module.id), ['m1']);
    assert.equal(c.published, true);
    assert.match((await a.get('/admin/courses?status=pending')).html, /Pending module · Independent module/);
    assert.equal((await a.post(`/admin/courses/${c.id}/approve-publication`, { revisionId: moduleDraft.id })).status, 302);
    assert.deepEqual((await c.reload()).modules.map(module => module.id), ['m1', 'm2']);
    assert.ok(await Notification.findOne({ where: { userId: faculty.id, title: 'Module publication approved' } }));
    assert.match((await Notification.findOne({ where: { userId: student.id, title: 'New module published' } })).message, /published Independent module/);
    assert.equal((await a.post(`/admin/courses/${c.id}/approve-publication`, { revisionId: moduleDraft.id })).status, 400);
    r=await a.post(`/admin/courses/${c.id}/ownership`,{ownerId:otherFaculty.id});assert.equal(r.status,302);assert.equal((await f.get(`/faculty/courses/${c.id}/edit`)).status,404);assert.equal((await f2.get(`/faculty/courses/${c.id}/edit`)).status,200);
    for (let index = 1; index <= 5; index++) {
      await Course.create({
        ...draft, ownerId: otherFaculty.id, slug: 'outline-' + index, title: 'Outline Course ' + index,
        published: true, modules: [{ ...draft.modules[0], title: 'Searchable Module ' + index }]
      });
    }
    const firstPage = await f2.get('/faculty/courses?q=searchable+module');
    assert.equal(firstPage.status, 200);
    assert.match(firstPage.html, /Page 1 of 2/);
    assert.doesNotMatch(firstPage.html, /OUTLINE COURSE 1/);
    const secondPage = await f2.get('/faculty/courses?q=searchable+module&page=2');
    assert.match(secondPage.html, /OUTLINE COURSE 1/);
    assert.match(secondPage.html, /1 module/);
    const archiveTarget = await Course.findOne({ where: { slug: 'outline-1' } });
    const moduleCards = await f2.get('/faculty/courses?page=2&course=' + archiveTarget.id);
    assert.equal(moduleCards.status, 200);
    assert.match(moduleCards.html, /<h2>Searchable Module 1<\/h2>/);
    assert.doesNotMatch(moduleCards.html, /class="eyebrow">Outline Course 1/);
    assert.equal((await f.get('/faculty/courses?course=' + archiveTarget.id)).status, 404);
    assert.equal((await f2.post('/faculty/courses/' + archiveTarget.id + '/archive', {})).status, 302);
    assert.doesNotMatch((await f2.get('/faculty/courses?q=Outline+Course+1')).html, /<h2>OUTLINE COURSE 1/);
    assert.match((await f2.get('/faculty/courses?list=archive&q=searchable+module+1')).html, /<h2>OUTLINE COURSE 1/);
    assert.equal((await s.get('/student/courses/' + archiveTarget.id)).status, 404);
    const generatedModuleDraft = await Course.create({
      ...draft, ownerId: otherFaculty.id, slug: 'generated-module-draft', published: false,
      modules: [...draft.modules, { ...draft.modules[0], id: 'legacy-group', title: 'Legacy topic group',
        lessons: [{ ...draft.modules[0].lessons[0], id: 'legacy-topic' }] }],
      questions: [...draft.questions, { ...draft.questions[0], id: 'legacy-question', moduleId: 'legacy-group', lessonId: 'legacy-topic' }]
    });
    await AiJob.create({ userId: otherFaculty.id, type: 'course-draft', status: 'completed', courseId: generatedModuleDraft.id });
    const attachUrl = '/faculty/courses/' + generatedModuleDraft.id + '/attach-module';
    const copyFields = { destinationId: c.id, moduleId: 'all', moduleTitle: 'Recovered module' };
    assert.equal((await f2.post(attachUrl, copyFields)).status, 302);
    assert.equal((await f2.post(attachUrl, copyFields)).status, 302);
    const recovered = await CourseRevision.findAll({ where: { courseId: c.id, action: 'module-draft' } });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].snapshot.module.title, 'Recovered module');
    assert.equal(recovered[0].snapshot.questions.length, draft.questions.length + 1);
    const copiedTopic = recovered[0].snapshot.module.lessons.at(-1);
    assert.equal(recovered[0].snapshot.questions.at(-1).lessonId, copiedTopic.id);
    assert.equal((await c.reload()).modules.length, 2);

    await Setting.upsert({ key: `facultySignature:${otherFaculty.id}`, value: signature });
    const duplicateSource = await SourceDocument.create({
      ownerId: otherFaculty.id, filename: 'Duplicate check', sections: [{ reference: 'Paragraph 1', text: 'Tourism material.' }]
    });
    const duplicateGeneration = await f2.request(`/faculty/sources/${duplicateSource.id}/generate`, {
      method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': f2.csrf },
      body: new URLSearchParams({ destinationId: c.id, moduleTitle: '  SERVICE FUNDAMENTALS  ', domain: domains[0],
        questionCount: 5, consent: 'yes', background: 'yes' })
    });
    assert.equal(duplicateGeneration.status, 409);
    assert.match(duplicateGeneration.html, /COURSE_DUPLICATE_MODULE/);

    const actionUrl = `/faculty/courses/${c.id}/module/m2`;
    const modulePreview = await f2.get(actionUrl + '/preview');
    assert.equal(modulePreview.status, 200);
    assert.match(modulePreview.html, /Revised topic area/);
    assert.equal((await f.post(actionUrl + '/unpublish', {})).status, 404);
    const editModule = await f2.post(actionUrl + '/edit', {});
    assert.equal(editModule.status, 302);
    const scopedEdit = await f2.get(editModule.location.split('#')[0]);
    assert.match(scopedEdit.html, /Submit reviewed module for Admin approval/);
    assert.match(scopedEdit.html, /id="course-editor" data-module-editor/);
    const revisionId = new URL(editModule.location, 'http://local').searchParams.get('revision');
    const editData = { modules: [{ ...c.modules[1], title: 'Edited module draft', outcomes: ['Explain an independent module concept.'] }],
      questions: c.questions.filter(question => question.moduleId === 'm2') };
    assert.equal((await f2.post(`/faculty/courses/${c.id}/modules/${revisionId}/topics`, {
      courseData: JSON.stringify(editData), action: 'draft'
    })).status, 302);
    assert.equal((await CourseRevision.findByPk(revisionId)).snapshot.module.title, 'Edited module draft');
    assert.deepEqual((await CourseRevision.findByPk(revisionId)).snapshot.module.outcomes, ['Explain an independent module concept.']);
    assert.equal((await c.reload()).modules[1].title, 'Independent module');
    const editing = await CourseRevision.findOne({ where: { id: new URL(editModule.location, 'http://local').searchParams.get('revision') } });
    assert.equal((await f2.post(actionUrl + '/delete-draft', { revisionId: editing.id })).status, 302);
    assert.equal((await f2.post(actionUrl + '/unpublish', {})).status, 302);
    assert.deepEqual((await c.reload()).modules.map(module => module.id), ['m1']);
    const archivedModule = await CourseRevision.findOne({ where: { courseId: c.id, action: 'module-archived' } });
    assert.doesNotMatch((await f2.get(`/faculty/courses?list=archive&course=${c.id}`)).html, /<button[^>]*>Republish/);
    assert.equal((await f2.post(actionUrl + '/republish', { revisionId: archivedModule.id })).status, 409);
    // A previously queued module remains reviewable after the Faculty republish action is retired.
    await archivedModule.update({ action: 'module-pending' });
    const pendingModuleCard = await f2.get(`/faculty/courses?status=pending&course=${c.id}`);
    assert.match(pendingModuleCard.html, /publication-pending/);
    assert.match(pendingModuleCard.html, /Cancel submission/);
    assert.match((await f2.get('/faculty/courses?status=pending')).html, /pending-publication-label/);
    assert.match((await a.get('/admin/courses?status=pending')).html, /reason for declining/);
    assert.match((await a.get('/admin')).html, /publication-needs-review/);
    assert.match((await a.get('/admin/courses?status=pending')).html, /publication-needs-review/);
    const publicationUrl = `/admin/courses/${c.id}`;
    const submission = { revisionId: archivedModule.id };
    assert.equal((await a.post(publicationUrl + '/decline-publication', { ...submission, reason: '   ' })).status, 400);
    assert.equal((await f.post(actionUrl + '/cancel-submission', submission)).status, 404);
    const cancelled = await f2.post(actionUrl + '/cancel-submission', submission);
    assert.equal(cancelled.location, `/faculty/courses?list=drafts&course=${c.id}`);
    assert.equal((await archivedModule.reload()).action, 'module-draft');
    assert.equal((await a.post(publicationUrl + '/approve-publication', submission)).status, 400);
    const resubmitUrl = `/faculty/courses/${c.id}/modules/${archivedModule.id}/submit`;
    assert.equal((await f2.post(resubmitUrl, { confirmReview: 'yes' })).status, 302);
    const reason = 'Add a source reference before publishing.';
    assert.equal((await a.post(publicationUrl + '/decline-publication', { ...submission, reason })).status, 302);
    assert.match((await f2.get(cancelled.location)).html, /Add a source reference before publishing/);
    assert.ok(await Notification.findOne({ where: { userId: otherFaculty.id, title: 'Publication declined' } }));
    assert.equal((await a.post(publicationUrl + '/approve-publication', submission)).status, 400);
    assert.equal((await f2.post(resubmitUrl, { confirmReview: 'yes' })).status, 302);
    assert.equal((await a.post(`/admin/courses/${c.id}/approve-publication`, { revisionId: archivedModule.id })).status, 302);
    assert.deepEqual((await c.reload()).modules.map(module => module.id), ['m1', 'm2']);

    const singleCourse = await Course.create({
      ...draft, ownerId: otherFaculty.id, slug: 'single-module-lifecycle', published: true, certificateEnabled: false
    });
    const singleAdmin = `/admin/courses/${singleCourse.id}`;
    assert.equal((await a.post(singleAdmin, {
      version: singleCourse.version, unpublish: 'yes'
    })).status, 302);
    await singleCourse.reload();
    assert.equal((await s.get(`/student/courses/${singleCourse.id}`)).status, 404);
    assert.match((await a.get('/admin/courses')).html, /Republish course/);
    assert.equal((await a.post(singleAdmin + '/republish', { version: singleCourse.version })).status, 302);
    assert.equal((await s.get(`/student/courses/${singleCourse.id}`)).status, 200);
    const singleAction = `/faculty/courses/${singleCourse.id}/module/m1`;
    assert.equal((await f2.post(singleAction + '/unpublish', {})).status, 302);
    assert.equal((await singleCourse.reload()).published, false);
    const singleArchived = await CourseRevision.findOne({ where: { courseId: singleCourse.id, action: 'module-archived' } });
    assert.match((await a.get('/admin/courses')).html, /Republish module/);
    assert.equal((await f2.post(singleAdmin + '/republish', { revisionId: singleArchived.id })).status, 403);
    assert.equal((await a.post(singleAdmin + '/republish', { revisionId: singleArchived.id })).status, 302);
    assert.equal((await a.post(singleAdmin + '/republish', { revisionId: singleArchived.id })).status, 400);
    assert.equal((await s.get(`/student/courses/${singleCourse.id}`)).status, 200);
    assert.equal((await singleCourse.reload()).published, true);
    assert.equal((await f2.post(singleAction + '/unpublish', {})).status, 302);
    const toDelete = await CourseRevision.findOne({ where: { courseId: singleCourse.id, action: 'module-archived' } });
    assert.equal((await f2.post(singleAction + '/delete-module', { revisionId: toDelete.id })).status, 302);
    assert.equal((await toDelete.reload()).action, 'module-deleted');

    const studentCourse = await Course.create({
      ...draft, ownerId: otherFaculty.id, slug: 'student-independent-module-access', published: true,
      certificateEnabled: false, policy: { quizWeight: 0, finalWeight: 100, practicalWeight: 0 }, tasks: [], prerequisites: [singleCourse.id], enrollUntil: new Date('2020-01-01')
    });
    const catalogUrl = `/student/courses/${studentCourse.id}`;
    const firstStart = await s.post(catalogUrl + '/enroll', { moduleId: 'm1' });
    assert.equal(firstStart.status, 302);
    const learnerAttempt = await CourseAttempt.findOne({ where: { courseId: studentCourse.id, userId: student.id } });
    const learnUrl = `/student/learn/${learnerAttempt.id}`;
    await learnerAttempt.update({ completedLessons: ['l1'], quizScores: { m1: 50 } });
    const moduleTwo = { ...c.modules.find(module => module.id === 'm2'), outcomes: ['Explain an independent module concept.'] };
    const moduleTwoQuestions = c.questions.filter(question => question.moduleId === moduleTwo.id);
    const pending = await CourseRevision.create({
      courseId: studentCourse.id, actorId: otherFaculty.id, version: studentCourse.version, action: 'module-pending',
      snapshot: { module: moduleTwo, questions: moduleTwoQuestions }
    });
    assert.doesNotMatch((await s.get(catalogUrl)).html, /Independent module/);
    assert.equal((await a.post(`/admin/courses/${studentCourse.id}/approve-publication`, { revisionId: pending.id })).status, 302);
    const published = await s.get(catalogUrl);
    assert.match(published.html, /Independent module/);
    assert.match(published.html, /<summary>Learning outcomes<\/summary>/);
    assert.match(published.html, /<li>Explain an independent module concept\.<\/li>/);
    assert.doesNotMatch(published.html, /<h2>Learning outcomes<\/h2>|View topics/);
    assert.equal((published.html.match(/Take assessment/g) || []).length, 1);
    assert.match(published.html, /module-failed/);
    assert.match(published.html, /Quiz score 50%/);
    assert.match(published.html, /\/retake\/m1/);
    const myLearning = await s.get('/student/learning');
    assert.match(myLearning.html, /module-failed/);
    assert.match(myLearning.html, /\/retake\/m1/);
    assert.equal((await s.post(catalogUrl + '/enroll', { moduleId: 'm2' })).location, learnUrl + '?lesson=' + moduleTwo.lessons[0].id);
    assert.doesNotMatch((await s.get('/student/learning')).html, /Independent module/);
    assert.equal((await s.post(catalogUrl + '/modules/m2/save', {})).status, 302);
    assert.match((await s.get('/student/courses?view=saved')).html, /Independent module/);
    assert.equal((await learnerAttempt.reload()).quizScores.m1, 50);
    assert.deepEqual(learnerAttempt.completedLessons, ['l1']);
    const failure = { scope: 'm2', score: 25, at: new Date().toISOString() };
    await learnerAttempt.update({
      completedLessons: ['l1', ...moduleTwo.lessons.map(lesson => lesson.id)],
      quizScores: { m1: 50, m2: 25 }, quizAttempts: [failure]
    });
    const retake = await s.post(learnUrl + '/retake/m2', {});
    assert.equal(retake.location, learnUrl + '?lesson=' + moduleTwo.lessons[0].id);
    await learnerAttempt.reload();
    assert.deepEqual(learnerAttempt.completedLessons, ['l1']);
    assert.deepEqual(learnerAttempt.quizScores, { m1: 50, 'retake:m2': 1 });
    assert.deepEqual(learnerAttempt.quizAttempts, [failure]);
    assert.match((await s.get('/student/learning')).html, /Retakes: 1/);
    for (const lesson of moduleTwo.lessons.slice(1)) {
      assert.equal((await s.get(learnUrl + '?lesson=' + lesson.id)).status, 403);
    }
    assert.equal((await s.get(learnUrl + '/quiz/m2')).status, 403);
    assert.equal((await s.post(learnUrl + '/retake/m2', {})).status, 403);
    await learnerAttempt.update({ completedLessons: ['l1', ...moduleTwo.lessons.map(lesson => lesson.id)] });
    assert.equal((await s.get(learnUrl + '/quiz/m2')).status, 302);
    for (const lesson of moduleTwo.lessons) {
      const page = await s.get(learnUrl + '?lesson=' + lesson.id);
      assert.equal(page.status, 200);
      const previousIndex = moduleTwo.lessons.indexOf(lesson) - 1;
      if (previousIndex >= 0) {
        const previousLink = page.html.match(/href="([^"]+)" data-topic-previous/);
        assert.ok(previousLink);
        assert.equal(previousLink[1].split('#')[0], learnUrl + '?lesson=' + moduleTwo.lessons[previousIndex].id);
      } else {
        assert.doesNotMatch(page.html, /data-topic-previous/);
      }
      const revision = page.html.match(/data-revision="([0-9]+)"/);
      if (!revision) continue;
      const ids = [...new Set([...page.html.matchAll(/name="answers\[([^\]]+)\]"/g)].map(match => match[1]))];
      const answers = Object.fromEntries(ids.map(id => [id, String(moduleTwoQuestions.find(question => question.id === id).answer)]));
      const saved = await s.request(learnUrl + '/draft/m2?topic=' + lesson.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf },
        body: JSON.stringify({ revision: Number(revision[1]), answers })
      });
      assert.equal(saved.status, 200);
    }
    assert.equal((await s.get(learnUrl + '/quiz/m2')).status, 200);
    const answers = Object.fromEntries(moduleTwoQuestions.map(question => [`answers[${question.id}]`, String(question.answer)]));
    const submitted = await s.post(learnUrl + '/quiz/m2', {
      challenge: issueChallenge(student.id, `${learnerAttempt.id}:m2`), ...answers
    });
    assert.match(submitted.location, /\/result\//);
    assert.equal((await learnerAttempt.reload()).quizScores.m2, 100);
    assert.equal((await s.get(learnUrl + '/final')).status, 403);
    assert.equal((await s.post(catalogUrl + '/modules/m2/save', {})).status, 302);
    assert.doesNotMatch((await s.get('/student/courses?view=saved')).html, /Independent module/);

    assert.equal((await f2.post(`/faculty/courses/${studentCourse.id}/module/m2/unpublish`, {})).status, 302);
    assert.doesNotMatch((await s.get(catalogUrl)).html, /Independent module/);
    assert.doesNotMatch((await s.get('/student/courses?view=saved')).html, /Independent module/);
    assert.equal((await s.get(learnUrl + '/quiz/m2')).status, 403);
    assert.equal((await s.post(catalogUrl + '/enroll', { moduleId: 'm2' })).status, 404);

    await learnerAttempt.update({ status: 'completed', finalScore: 100, completedLessons: ['l1'], quizScores: { m1: 100 } });
    const archived = await CourseRevision.findOne({ where: { courseId: studentCourse.id, action: 'module-archived' } });
    assert.equal((await a.post(`/admin/courses/${studentCourse.id}/republish`, { revisionId: archived.id })).status, 302);
    assert.doesNotMatch((await s.get('/student/courses?view=saved')).html, /Independent module/);
    const nextStart = await s.post(catalogUrl + '/enroll', { moduleId: 'm2' });
    const nextAttempt = await CourseAttempt.findOne({ where: { courseId: studentCourse.id, userId: student.id, attemptNumber: 2 } });
    assert.equal(nextStart.location, `/student/learn/${nextAttempt.id}?lesson=${moduleTwo.lessons[0].id}`);
    assert.equal(nextAttempt.quizScores.m1, 100);
    assert.equal((await learnerAttempt.reload()).status, 'completed');

    const courseSubmission = await Course.create({
      ...draft, ownerId: otherFaculty.id, slug: 'whole-course-decision', published: false, certificateEnabled: false
    });
    const addPendingCourse = () => CourseRevision.create({
      courseId: courseSubmission.id, actorId: otherFaculty.id, version: courseSubmission.version, action: 'pending-review'
    });
    await addPendingCourse();
    const wholeAction = `/faculty/courses/${courseSubmission.id}/module/m1/cancel-submission`;
    assert.equal((await f2.post(wholeAction, {})).status, 302);
    assert.equal((await CourseRevision.findOne({ where: { courseId: courseSubmission.id } })).action, 'publication-cancelled');
    await addPendingCourse();
    assert.equal((await a.post(`/admin/courses/${courseSubmission.id}/decline-publication`, {
      version: courseSubmission.version, reason: 'Clarify the whole-course objectives.'
    })).status, 302);
    assert.match((await f2.get(`/faculty/courses?list=drafts&course=${courseSubmission.id}`)).html, /Clarify the whole-course objectives/);
    assert.equal((await courseSubmission.reload()).published, false);

    const attachFields = { destinationId: archiveTarget.id, moduleId: draft.modules[0].id, moduleNumber: 7, moduleTitle: 'Advanced Module' };
    assert.match((await f2.get('/faculty/courses/' + generatedModuleDraft.id + '/edit')).html, /Copy generated content into an existing course/);
    assert.equal((await f2.post(attachUrl, attachFields)).status, 302);
    assert.equal((await f2.post(attachUrl, attachFields)).status, 400);
    await archiveTarget.reload();
    const attached = archiveTarget.modules.find(module => module.number === 7);
    assert.equal(attached.title, 'Advanced Module');
    assert.ok(archiveTarget.questions.some(question => question.moduleId === attached.id && !question.reviewed));
    assert.match((await f2.get('/faculty/courses?list=archive&q=Advanced+Module&course=' + archiveTarget.id)).html, /<h2>Advanced Module<\/h2>/);
    const legacyReview = await f2.post(`/faculty/courses/${generatedModuleDraft.id}/module/m1/review`, {});
    assert.equal(legacyReview.status, 302);
    const legacyRevision = new URL(legacyReview.location, 'http://local').searchParams.get('revision');
    assert.equal((await f2.post(`/faculty/courses/${generatedModuleDraft.id}/modules/${legacyRevision}/topics`, {
      confirmReview: 'yes', action: 'publish',
      courseData: JSON.stringify({ modules: [draft.modules[0]], questions: draft.questions })
    })).status, 302);
    assert.equal((await a.post(`/admin/courses/${generatedModuleDraft.id}/approve-publication`, { revisionId: legacyRevision })).status, 302);
    assert.deepEqual((await generatedModuleDraft.reload()).modules.map(module => module.id), ['m1']);
    const siblingDraft = await CourseRevision.findOne({ where: { courseId: generatedModuleDraft.id, action: 'module-draft' } });
    assert.equal(siblingDraft.snapshot.module.id, 'legacy-group');

    const { ensureCompletionCredential } = await import('../services/portalLearning.js');
    const moduleAwardAttempt = await CourseAttempt.findByPk(id);
    await moduleAwardAttempt.update({ snapshot: { ...moduleAwardAttempt.snapshot, modules: [
      { id: 'new-module-1', title: 'Module One', skills: ['Guest communication'] },
      { id: 'new-module-2', title: 'Module Two', skills: ['Reservation handling'] }
    ] } });
    const [firstModule, secondModule] = moduleAwardAttempt.snapshot.modules;
    assert.equal(await ensureCompletionCredential(moduleAwardAttempt, student, 0, undefined, firstModule), null);
    const firstAward = await ensureCompletionCredential(moduleAwardAttempt, student, 100, undefined, firstModule);
    assert.equal((await ensureCompletionCredential(moduleAwardAttempt, student, 100, undefined, firstModule)).id, firstAward.id);
    const secondAward = await ensureCompletionCredential(moduleAwardAttempt, student, 100, undefined, secondModule);
    assert.notEqual(secondAward.id, firstAward.id);
    const verification = await s.get('/verify/' + firstAward.id);
    assert.match(verification.html, /Guest communication/);
    assert.doesNotMatch(verification.html, /Reservation handling/);
    const archivedAttempt = await CourseAttempt.create({
      userId: student.id, courseId: archiveTarget.id, courseVersion: archiveTarget.version,
      attemptNumber: 1, snapshot: moduleAwardAttempt.snapshot, status: 'completed'
    });
    const archivedAward = await Credential.create({ userId: student.id, attemptId: archivedAttempt.id, moduleId: firstModule.id });
    await QuizDraft.create({ userId: student.id, attemptId: archivedAttempt.id, scope: firstModule.id });
    const deleteArchive = '/faculty/courses/' + archiveTarget.id + '/archive/delete';
    assert.equal((await f.post(deleteArchive, { confirmDelete: 'yes' })).status, 404);
    assert.ok((await f2.get('/faculty/courses?list=archive&course=' + archiveTarget.id)).html.includes('/module/m1/delete-module'));
    assert.equal((await f2.post(deleteArchive, {})).status, 400);
    assert.equal((await f2.post(deleteArchive, { confirmDelete: 'yes' })).status, 302);
    assert.equal(await Course.findByPk(archiveTarget.id), null);
    assert.equal(await CourseAttempt.findByPk(archivedAttempt.id), null);
    assert.equal(await Credential.findByPk(archivedAward.id), null);
    assert.equal(await QuizDraft.count({ where: { attemptId: archivedAttempt.id } }), 0);
    assert.ok(await Credential.findByPk(firstAward.id));
    const source=await SourceDocument.create({ownerId:otherFaculty.id,filename:'sample.docx',sections:[{reference:'Paragraph 1',text:draft.questions[0].sourceQuote.repeat(8)}]});
    process.env.GEMINI_API_KEY='dummy-unit-test-key';process.env.GEMINI_MODEL='dummy-test-model';await Setting.upsert({key:'aiDailyLimit',value:'2'});const original=globalThis.fetch;
    try{globalThis.fetch=async url=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({...draft,questions:[1,2,3].map(n=>({...draft.questions[0],id:'q'+n})),tasks:[],policy:{quizWeight:40,finalWeight:60,practicalWeight:0}})}]}}]}),{status:200});const result=await generateCourse(otherFaculty.id,source,{domain:domains[0],level:'Foundation',questionCount:3,outcomes:'Apply the source.'});assert.equal(result.draft.questions[0].reviewed,false);assert.equal(result.job.status,'completed');
      globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({...draft,questions:[1,2,3].map(n=>({...draft.questions[0],id:'q'+n,sourceQuote:'An invented quote that is not in the material.'})),tasks:[],policy:{quizWeight:40,finalWeight:60,practicalWeight:0}})}]}}]}),{status:200});const unsupported=await generateCourse(otherFaculty.id,source,{domain:domains[0],questionCount:3,outcomes:'Apply the source.'});assert.equal(unsupported.job.status,'completed');assert.equal(unsupported.draft.questions[0].sourceNeedsReview,true,'unverified quotes are retained for one course-wide faculty review before publishing');
    }finally{globalThis.fetch=original;delete process.env.GEMINI_API_KEY;delete process.env.GEMINI_MODEL;}
  }finally{await new Promise(resolve=>server.close(resolve));await closeResources();}
});
