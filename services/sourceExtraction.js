import JSZip from "jszip";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fail } from "./courseAuthoring.js";
import { sourceLimits as limits } from "./sourceLimits.js";
const clean = (s) => s.replace(/\s+/g, " ").trim();
export async function extractSource(file, { onProgress } = {}) {
  if (!file?.buffer?.length || file.buffer.length > limits.fileBytes)
    fail("Upload a PDF, DOCX, PPTX or TXT up to 100 MB.");
  const ext = file.originalname.split(".").pop().toLowerCase();
  let sections = [];
  if (ext === "pdf") {
    if (file.buffer.subarray(0, 5).toString() !== "%PDF-")
      fail("The uploaded file is not a PDF.");
    let pdf, task;
    try {
      task = getDocument({
        data: new Uint8Array(file.buffer),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      pdf = await task.promise;
      if (pdf.numPages > limits.pages)
        fail("Each PDF can contain up to 300 pages. Split longer documents.");
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        sections.push({
          reference: `Page ${n}`,
          text: clean(content.items.map((i) => i.str || "").join(" ")),
        });
        page.cleanup();
        onProgress?.({ phase: 'extracting', current: n, total: pdf.numPages, unit: 'pages' });
        if (
          sections.reduce((sum, s) => sum + s.text.length, 0) >
          limits.textCharacters
        )
          fail(
            "Source exceeds 1,000,000 extracted characters. Add remaining material to another course.",
          );
      }
    } finally {
      await task?.destroy();
    }
  } else if (ext === "docx" || ext === "pptx") {
    if (file.buffer.subarray(0, 2).toString() !== "PK")
      fail("Invalid Office document.");
    const zip = await JSZip.loadAsync(file.buffer);
    const entries = Object.values(zip.files);
    if (
      entries.length > 5000 ||
      entries.reduce((sum, e) => sum + (e._data?.uncompressedSize || 0), 0) >
        100 * 1024 * 1024
    )
      fail("The decompressed document is too large.");
    if (ext === "docx") {
      if (!zip.file("word/document.xml")) fail("Invalid DOCX document.");
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      sections = result.value
        .split(/\n\s*\n/)
        .filter((s) => s.trim())
        .map((s, i) => ({ reference: `Paragraph ${i + 1}`, text: clean(s) }));
      onProgress?.({ phase: 'extracting', current: 1, total: 1, unit: 'document' });
    } else {
      const files = entries
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
        .sort(
          (a, b) =>
            Number(a.name.match(/slide(\d+)/)[1]) -
            Number(b.name.match(/slide(\d+)/)[1]),
        );
      if (!files.length || files.length > limits.pages)
        fail("Use a PPTX with 1–300 slides.");
      const decode = (s) =>
        s
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&");
      for (const file of files) {
        const xml = await file.async("string");
        sections.push({
          reference: `Slide ${file.name.match(/slide(\d+)/)[1]}`,
          text: clean(
            [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
              .map((m) => decode(m[1]))
              .join(" "),
          ),
        });
        onProgress?.({ phase: 'extracting', current: sections.length, total: files.length, unit: 'slides' });
      }
    }
  } else if (ext === "txt") {
    if (file.buffer.includes(0)) fail("Use a UTF-8 text file.");
    sections = file.buffer
      .toString("utf8")
      .split(/\n\s*\n/)
      .filter((s) => s.trim())
      .map((s, i) => ({ reference: `Paragraph ${i + 1}`, text: clean(s) }));
    onProgress?.({ phase: 'extracting', current: 1, total: 1, unit: 'document' });
  } else
    fail(
      "Supported formats: PDF, DOCX, PPTX and TXT. Save legacy DOC files as DOCX or PDF first.",
    );
  sections = sections.filter((s) => s.text);
  const length = sections.reduce((n, s) => n + s.text.length, 0);
  if (length === 0) sections = [{ reference: 'No searchable text · manual verification required', text: '' }];
  if (length > limits.textCharacters || sections.length > limits.sections)
    fail(
      "Source exceeds 1,000,000 extracted characters or 10,000 sections. Add remaining material to another course.",
    );
  return sections;
}

