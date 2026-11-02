import test from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './httpHelpers.js';
process.env.NODE_ENV='test';process.env.TEST_DB_STORAGE=':memory:';
const {sequelize}=await import('../models/learningModels.js');const {seedAdministration}=await import('../services/accounts.js');const {startServer,closeResources}=await import('../index.js');
await test('login/register render the restored landing with role-aware bounded dialogs and preserve error messages',async()=>{
 await sequelize.sync({force:true});await seedAdministration();const server=await startServer(0),b=browser(`http://127.0.0.1:${server.address().port}`);
 try{
  let r=await b.get('/login');assert.equal(r.status,200);assert.match(r.html,/Bridge the Gap Between/);assert.match(r.html,/id="loginModal"[^>]*class="auth-overlay flex/);assert.ok(!r.html.toLowerCase().includes('back to home'));
  assert.match(r.html,/YOUR CAREERBRIDGE JOURNEY/);assert.match(r.html,/cb-feature-card/);assert.doesNotMatch(r.html,/78%|94%|10 Structured Modules|7\+ Career Pathways|Illustrative dashboard preview/);assert.equal((r.html.match(/class="carousel-slide /g)||[]).length,3);
  const about=await b.get('/about');assert.equal(about.status,200);assert.match(about.html,/bstm-student-models.png/);assert.match(about.html,/Active faculty/);
  r=await b.get('/register?role=faculty');assert.equal(r.status,200);assert.match(r.html,/id="registerModal"[^>]*class="auth-overlay flex/);const form=r.html.match(/<form[^>]*data-registration-form>[\s\S]*?<\/form>/)[0];assert.match(form,/Faculty ID/);assert.match(form,/value="faculty" selected/);assert.match(form,/name="section"[^>]*disabled/);assert.ok(!r.html.toLowerCase().includes('back to home'));
  r=await b.post('/login',{email:'unknown@example.test',password:'DummyInvalidPassword!'});assert.equal(r.location,'/login');r=await b.get('/login');const dialog=r.html.split('id="loginModal"')[1].split('id="registerModal"')[0];assert.match(dialog,/Invalid email or password/);assert.match(dialog,/notice error/);
  r=await b.get('/');assert.ok(!r.html.includes('Invalid email or password'),'flash consumes exactly once');assert.match(r.html,/id="loginModal"[^>]*class="auth-overlay hidden/);
  r=await b.get('/?auth=register&role=faculty');assert.match(r.html,/value="faculty" selected/);assert.match(r.html,/id="registerModal"[^>]*class="auth-overlay flex/);
  r=await b.post('/register/cancel-google',{exit:'yes'});assert.equal(r.location,'/');
 }finally{await new Promise(r=>server.close(r));await closeResources();}
});
