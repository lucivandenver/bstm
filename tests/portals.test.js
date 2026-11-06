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
  const {careerMatches}=await import('../s