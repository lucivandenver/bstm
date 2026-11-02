import JSZip from 'jszip';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fail } from './courseAuthoring.js';
const clean = s => s.replace(/\s+/g, ' ').trim();
export async function extractSource(file) {
  if (!file?.buffer?.length || file.buffer.length > 8 * 1024 * 1024) fail('Upload a PDF, DOCX or PPTX up to 8 MB.');
  const ext = file.originalname.split('.').pop().toLowerCase(); let sections = [];
  if (ext === 'pdf') {
    if (file.buffer.subarray(0, 5).toString() !== '%PDF-') fail('The uploaded file is not a PDF.');
    let pdf, task;
    try {
      task = getDocument({ data: new Uint8Array(file.buffer), isEvalSupported: false, useSystemFonts: true });
      pdf = await task.promise;
      if (pdf.numPages > 80) fail('Split the PDF into documents of at most 80 pages.');
      for (let n = 1; n <= pdf.numPages; n++) { const page = await pdf.getPage(n); const content = await page.getTextContent(); sections.push({ reference: `Page ${n}`, text: clean(content.items.map(i => i.str || '').join(' ')) }); }
    } finally { await task?.destroy(); }
  } else if (ext === 'docx' || ext === 'pptx') {
    if (file.buffer.subarray(0, 2).toString() !== 'PK') fail('Invalid Office document.');
    const zip = await JSZip.loadAsync(file.buffer);
    const entries = Object.values(zip.files);
    if (entries.length > 5000 || entries.reduce((sum, e) => sum + (e._data?.uncompressedSize || 0), 0) > 20 * 1024 * 1024) fail('The decompressed document is too large.');
    if (ext === 'docx') {
      if (!zip.file('word/document.xml')) fail('Invalid DOCX document.');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      sections = result.value.split(/\n\s*\n/).filter(s => s.trim()).map((s, i) => ({ reference: `Paragraph ${i + 1}`, text: clean(s) }));
    } else {
      const files = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a,b) => Number(a.name.match(/slide(\d+)/)[1]) - Number(b.name.match(/slide(\d+)/)[1]));
      if (!files.length || files.length > 80) fail('Use a PPTX with 1–80 slides.');
      const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      for (const file of files) { const xml = await file.async('string'); sections.push({ reference: `Slide ${file.name.match(/slide(\d+)/)[1]}`, text: clean([...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m => decode(m[1])).join(' ')) }); }
    }
  } else fail('Supported source formats: PDF, DOCX and PPTX.');
  sections = sections.filter(s => s.text);
  const length = sections.reduce((n, s) => n + s.text.length, 0);
  if (length < 300) fail('Not enough selectable text. Scanned documents need OCR first; upload a text-based document.');
  if (length > 100000) fail('Source exceeds 100,000 characters; split it into smaller topics.');
  return sections;
}
