import test from 'node:test';import assert from 'node:assert/strict';import bcrypt from 'bcryptjs';import {browser} from './httpHelpers.js';
process.env.NODE_ENV='test';process.env.TEST_DB_STORAGE=':memory:';
const {sequelize,User,Course,CourseAttempt,Credential}=await import('../models/learningModels.js');const {seedAdministration}=await import('../services/accounts.js');const {startServer,closeResources}=await import('../index.js');
await test('career HTTP generation uses owned earned/developing evidence, returns matched roles and invalidates stale results',async()=>{
 await sequelize.sync({force:true});await seedAdministration();const password=await bcrypt.hash('TestingPassword-2026!',4);
 const user=await User.create({name:'Private Student Name',email:'private-student@example.test',studentId:'PRIVATE-ID',section:'BSTM 4-1',gender:'Female',password});
 const faculty=await User.create({name:'Course Faculty',email:'faculty-evidence@example.test',role:'faculty',active:true,approvalStatus:'approved',password});
 const course=await Course.create({ownerId:faculty.id,published:true,title:'Tourism service',slug:'career-evidence',domain:'Tourism and Hospitality Knowledge',modules:[{id:'m1',title:'Tourism service module',lessons:[{id:'l1',body:'Secret lesson text'}]},{id:'never-assessed',title:'Never assessed module',lessons:[{id:'untested'}]}],questions:[{moduleId:'m1',domain:'Tourism and Hospitality Knowledge'}]});
 const completed=await CourseAttempt.create({userId:user.id,courseId:course.id,attemptNumber:1,status:'completed',completedAt:new Date(),finalScore:85,snapshot:course.get({plain:true}),completedLessons:['l1','untested'],quizScores:{m1:85}});
 await Credential.create({userId:user.id,attemptId:completed.id,courseTitle:course.title,score:85,revoked:false});
 const other=await Course.create({ownerId:faculty.id,published:true,title:'Digital reservations',slug:'developing-evidence',domain:'Digital skills',modules:[{id:'m2',title:'Digital reservations module',lessons:[{id:'l2'},{id:'l3'}]}],questions:[{moduleId:'m2',domain:'Digital skills'}]});
 const developing=await CourseAttempt.create({userId:user.id,courseId:other.id,attemptNumber:1,status:'ongoing',snapshot:other.get({plain:true}),completedLessons:['l2'],quizScores:{m2:60,feedback:100}});
 await Course.create({ownerId:faculty.id,published:true,title:'Additional tourism module',slug:'unstarted-evidence',domain:course.domain,modules:[{id:'untaken',lessons:[]}]});
 const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`,client=browser(base),original=globalThis.fetch;
 const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL;
 try{
  await client.login(user.email,'TestingPassword-2026!');
  const dashboard=await client.get('/student');
  assert.match(dashboard.html,/Tourism and Hospitality Knowledge<\/strong><span>1 of 3 passed/);
  assert.match(dashboard.html,/Digital skills<\/strong><span>0 of 1 passed/);
  assert.match(dashboard.html,/Communication<\/strong><span>No available modules/);
  assert.match(dashboard.html,/Tourism and Hospitality Knowledge module progress" value="38" max="100"/);
  const facultyClient=browser(base);
  await facultyClient.login(faculty.email,'TestingPassword-2026!');
  const facultyProgress=await facultyClient.get('/faculty/students/'+user.id);
  assert.equal(facultyProgress.status,200);
  assert.match(facultyProgress.html,/1 of 3 available modules passed/);
  assert.match(facultyProgress.html,/value="38" max="100" aria-label="Tourism and Hospitality Knowledge progress"/);
  let r=await client.get('/student/careers');assert.match(r.html,/Your matches will appear here/);assert.doesNotMatch(r.html,/Travel Consultant \/ Tour Operations Assistant/,'first career visit keeps match content hidden');
  r=await client.get('/student/careers?find=matches');assert.match(r.html,/Travel Consultant \/ Tour Operations Assistant/,'career matches appear after the student asks to find them');
  process.env.GEMINI_API_KEY='test-key';process.env.GEMINI_MODEL='test-model';
  globalThis.fetch=async(url,init)=>{
   if(!String(url).startsWith('https://generativelanguage.googleapis.com/'))return original(url,init);
   assert(!init.body.includes(user.name));assert(!init.body.includes(user.email));assert(!init.body.includes(user.studentId));
   const payload=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);assert.equal(payload.learning.completed[0].score,85);assert.equal(payload.learning.completed.length,1);assert.equal(payload.learning.developing.length,1);assert(!init.body.includes('Never assessed module'));assert(!init.body.includes('Secret lesson text'));assert(!init.body.includes('courseTitle'));assert.equal(payload.learning.developing[0].score,60);assert(!Object.hasOwn(payload.scores,'Digital skills'),'below-passing quizzes do not become earned knowledge');
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({pathwayIndexes:[0],summary:'Invented certificate claim'})}]}}]});
  };
  const body=new URLSearchParams({_csrf:client.csrf,consent:'yes'});
  r=await client.request('/student/careers/generate',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body});assert.equal(r.status,200);assert.equal(JSON.parse(r.html).redirect,'/student/careers#ai-results');
  r=await client.get('/student/careers');assert.match(r.html,/Tourism service module/);assert.match(r.html,/Quiz 85%/);assert.doesNotMatch(r.html,/Invented certificate claim|Never assessed module/);assert.match(r.html,/id="ai-results"/);
  await developing.update({completedLessons:['l2','l3']});r=await client.get('/student/careers');assert.doesNotMatch(r.html,/id="ai-results"/,'changing progress invalidates the cached guidance');
  r=await client.request('/student/careers/generate',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:client.csrf})});assert.equal(r.status,400);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key;if(model===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=model;await new Promise(r=>server.close(r));await closeResources();}
});
