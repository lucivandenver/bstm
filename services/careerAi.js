export async function explainCareer(evidence) {
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return null;
  // No name, email, Student ID, OJT employer, or free-text profile is sent.
  const payload = { scores: evidence.scores, pathways: evidence.tracks.map(t => ({ title: t.title, label: t.label, strengths: t.strengths, gaps: t.gaps })) };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ contents: [{ parts: [{ text: `You are a BSTM learning guidance assistant. Explain ONLY the provided learning evidence. Do not invent credentials, job vacancies, employment probabilities or claim practical skills are verified. Preserve the listed pathways and their labels. Give a short supportive explanation and three learning next steps. Return JSON {"summary":"...","nextSteps":["...","...","..."]}. Evidence: ${JSON.stringify(payload)}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } })
  });
  if (!response.ok) throw new Error('AI guidance is temporarily unavailable.');
  const data = await response.json();
  const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}');
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.nextSteps) || parsed.nextSteps.length !== 3 || parsed.nextSteps.some(s => typeof s !== 'string')) throw new Error('Invalid AI response');
  return { summary: parsed.summary.slice(0, 1800), nextSteps: parsed.nextSteps.map(s => s.slice(0, 500)) };
}
