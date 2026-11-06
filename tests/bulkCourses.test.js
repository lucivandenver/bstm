import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { extractSource } from "../services/sourceExtraction.js";
import { browser } from "./httpHelpers.js";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-model";
process.env.NODE_ENV = "test";
process.env.TEST_DB_STORAGE = ":memory:";
const { sequelize, User, Course } = await import("../models/learningModels.js");
const { SourceDocument, AiJob } = await import("../models/portalModels.js");
const { Setting } = await import("../models/adminModels.js");
const { seedAdministration } = await import("../services/accounts.js");
const { courseBatches, sourceSections } =
  await import("../services/courseAi.js");
const { startServer, closeResources } = await import("../index.js");
const phrase =
  "Confirm guest requirements, check safety and accessibility, then verify booking availability. ";
async function docx(megabytes, text = phrase.repeat(500)) {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  if (megabytes)
    zip.file(
      "word/media/test-padding.bin",
      Buffer.alloc(megabytes * 1024 * 1024),
    );
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
function responseFor(payload) {
  const section = payload.sections.find((s) => s.text.length >= 100);
  return {
    insufficient: false,
    title: "Tourism information systems",
    description: "Understand and apply the supplied tourism booking concepts.",
    outcomes: ["Verify guest requirements and safe bookings."],
    minutes: 30,
    modules: [
      {
        title: "Tourism booking concepts",
        lessons: [
          {
            title: "Verify the booking",
            body: section.text.slice(0, 400),
            takeaways: ["Check before booking."],
          },
        ],
      },
    ],
    questions: Array.from({ length: payload.questionCount }, (_, i) => ({
      moduleIndex: 0,
      prompt: `Which booking action is appropriate in situation ${i + 1}?`,
      options: ["Confirm requirements", "Ignore safety"],
      answer: 0,
      explanation:
        "The teaching material requires confirmation and safety checks.",
      sourceReference: section.reference,
      sourceQuote: section.text.slice(0, 100),
    })),
  };
}
test("large source planning covers every character without overflowing course module limits", () => {
  const sections = Array.from({ length: 25 }, (_, i) => ({
    reference: `File ${i + 1}`,
    text: "x".repeat(39000),
  }));
  const batches = courseBatches(sections, 8);
  assert.equal(batches.length, 17);
  assert.equal(
    batches.reduce(
      (n, b) => n + b.sections.reduce((m, s) => m + s.text.length, 0),
      0,
    ),
    975000,
  );
  assert.equal(
    batches.reduce((n, b) => n + b.questionCount, 0),
    17,
  );
  assert.equal(
    courseBatches([{ reference: "One", text: "a".repeat(60001) }], 8).length,
    1,
    "tiny trailing fragments are not isolated",
  );
  assert.equal(
    sourceSections({ sections }).length,
    25,
    "collections above the previous 100k text limit are valid",
  );
});
let hundredMbPdf;
test("a valid PDF at exactly 100 MB passes source extraction", async () => {
  const pdf = new PDFDocument({ compress: false });
  const chunks = [];
  pdf.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => pdf.on("end", resolve));
  pdf.text(phrase.repeat(8));
  pdf.end();
  await finished;
  const raw = Buffer.concat(chunks),
    marker = raw.lastIndexOf("startxref");
  assert(marker > 0);
  // PDF whitespace between the trailer and startxref preserves existing offsets.
  