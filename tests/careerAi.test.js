import test from 'node:test';
import assert from 'node:assert/strict';
import { explainCareer } from '../services/careerAi.js';
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
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Keep learning.', nextSteps: ['Study', 'Practise', 'Ask faculty'] }) }] } }] }) };
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
