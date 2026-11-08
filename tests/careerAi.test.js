import test from 'node:test';
import assert from 'node:assert/strict';
import { explainCareer, careerLearningContext, careerFingerprint } from '../services/careerAi.js';
test('optional Gemini only receives anonymised evidence and validates its output', async () => {
  const original = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY; const model = process.env.GEMINI_MODEL;
  try {
    delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL;
    assert.equal(await explainCareer({}), null);
    process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_MODEL = 'test-model';
    globalThis.fetch = async (url, options) => {
      assert.ok(url.includes('/test-model:generateContent'));
      assert.ok(!options.body.includes('private@example.com'));
      assert.ok(!options.body.includes('Student Name'));
      assert.ok(options.body.includes('Digital skills'));
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Keep learning.', nextSteps: ['Study', 'Practise', 'Ask faculty'], matches:[{pathwayIndex:0,reason:'Related to assessed digital knowledge.',nextStep:'Practise guest communication.'}] }) }] } }] }) };
    };
    const evidence = { name: 'Student Name', email: 'private@example.com', scores: { 'Digital skills': 50 }, tracks: [{ title: 'Guest services', label: 'Developing', strengths: [], gaps: ['Digital skills'] }] };
    assert.equal((await explainCareer(evidence)).nextSteps.length, 3);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"summary":42}' }] } }] }) });
    await assert.rejects(explainCareer(evidence), /Invalid AI response/);
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(explainCareer(evidence), /temporarily unavailable/);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = model;
  }
});

test('career context separates unfinished learning and uses the latest completed attempt once',()=>{
 const base={courseId:4,snapshot:{title:'Digital fundamentals',domain:'Digital skills',modules:[{id:'m1'}]}};
 const old={...base,id:1,status:'completed',completedAt:'2026-01-01',finalScore:65};
 const recent={...base,id:2,status:'completed',completedAt:'2026-02-01',finalScore:90};
 const unfinished={...base,courseId:5,id:3,status:'ongoing',completedLessons:['l1'],quizScores:{m1:80}};
 const result=careerLearningContext([old,recent,unfinished],[{attemptId:2,revoked:false}]);
 assert.equal(result.completed.length,1);assert.equal(result.completed[0].finalScore,90);assert.equal(result.completed[0].certificateEarned,true);
 assert.equal(result.developing.length,1);assert.equal(result.developing[0].submittedQuizScores[0],80);
 const evidence={scores:{'Digital skills':90},tracks:[]};
 assert.notEqual(careerFingerprint(evidence,result),careerFingerprint(evidence,{...result,developing:[]}));
 assert.equal(careerLearningContext([recent],[{attemptId:2,revoked:true}]).completed[0].certificateEarned,false);
});

test('career guidance parses Groq responses and retains rule-ranked titles', async () => {
  const fetchBefore = globalThis.fetch;
  const keyBefore = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-groq-key';
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-groq-key');
      const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
      assert.equal(payload.pathways[0].title, 'Guest services');
      return Response.json({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({
          summary: 'Build your guest service experience.',
          nextSteps: ['Study', 'Practise', 'Review'],
          matches: [{ pathwayIndex: 0, reason: 'Aligned with your course.', nextStep: 'Review the module.' }],
        }),
      } }] });
    };
    const result = await explainCareer(
      { scores: {}, tracks: [{ title: 'Guest services', label: 'Developing' }] },
      undefined,
      { provider: 'groq', model: 'openai/gpt-oss-20b', ready: true },
    );
    assert.equal(result.matches[0].title, 'Guest services');
  } finally {
    globalThis.fetch = fetchBefore;
    if (keyBefore === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = keyBefore;
  }
});
